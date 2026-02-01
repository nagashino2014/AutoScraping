# 표 구조 인식 딥러닝 모델 상세 분석

## 개요

PDF 표 구조 복원의 정확도를 더욱 높이기 위한 딥러닝 기반 접근법을 분석합니다. 이 문서에서는 **TableNet**, **TabStruct-Net**, **YOLO-Table** 세 가지 핵심 모델의 작동 매커니즘과 자체 구현을 위한 가이드를 제공합니다.

---

## 1. TableNet 모델

### 1.1 개요

**TableNet**은 2019년 TCS Research에서 발표한 모델로, End-to-End 방식으로 문서 이미지에서 표를 감지하고 구조를 인식합니다.

**논문**: "TableNet: Deep Learning model for end-to-end Table detection and Tabular data extraction from Scanned Document Images" (ICDAR 2019)

### 1.2 작동 매커니즘

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         TableNet Architecture                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   입력 이미지                                                                 │
│       │                                                                      │
│       ▼                                                                      │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                    Encoder (VGG-19 Backbone)                        │    │
│  │  ┌─────────┐   ┌─────────┐   ┌─────────┐   ┌─────────┐   ┌───────┐ │    │
│  │  │ Conv1   │──▶│ Conv2   │──▶│ Conv3   │──▶│ Conv4   │──▶│ Conv5 │ │    │
│  │  │ Pool1   │   │ Pool2   │   │ Pool3   │   │ Pool4   │   │ Pool5 │ │    │
│  │  │ 64ch    │   │ 128ch   │   │ 256ch   │   │ 512ch   │   │ 512ch │ │    │
│  │  └─────────┘   └─────────┘   └─────────┘   └─────────┘   └───────┘ │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                              │                                               │
│                              ▼                                               │
│              ┌───────────────────────────────────┐                          │
│              │     Shared Feature Maps (Pool5)    │                          │
│              └───────────────────────────────────┘                          │
│                    │                       │                                 │
│         ┌──────────┘                       └──────────┐                      │
│         ▼                                             ▼                      │
│  ┌────────────────────────┐               ┌────────────────────────┐        │
│  │   Table Detection      │               │   Column Detection     │        │
│  │   Decoder Branch       │               │   Decoder Branch       │        │
│  │                        │               │                        │        │
│  │  Conv 1x1 (512→512)    │               │  Conv 1x1 (512→512)    │        │
│  │         ↓              │               │         ↓              │        │
│  │  Upsampling 2x         │               │  Upsampling 2x         │        │
│  │         ↓              │               │         ↓              │        │
│  │  Conv 1x1 (512→256)    │               │  Conv 1x1 (512→256)    │        │
│  │         ↓              │               │         ↓              │        │
│  │  Upsampling 2x         │               │  Upsampling 2x         │        │
│  │         ↓              │               │         ↓              │        │
│  │  Conv 1x1 (256→2)      │               │  Conv 1x1 (256→2)      │        │
│  └────────────────────────┘               └────────────────────────┘        │
│         │                                             │                      │
│         ▼                                             ▼                      │
│  ┌────────────────────────┐               ┌────────────────────────┐        │
│  │   Table Mask           │               │   Column Mask          │        │
│  │   (Binary Segmentation)│               │   (Binary Segmentation)│        │
│  └────────────────────────┘               └────────────────────────┘        │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 1.3 핵심 구성 요소

#### A. Encoder (인코더)

```python
import torch
import torch.nn as nn
import torch.nn.functional as F
from torchvision import models

class TableNetEncoder(nn.Module):
    """VGG-19 기반 인코더"""
    
    def __init__(self, pretrained=True):
        super().__init__()
        # VGG-19 백본 사용 (ImageNet 사전학습)
        vgg = models.vgg19(pretrained=pretrained)
        
        # 5개의 컨볼루션 블록
        self.conv1 = vgg.features[0:5]    # 64채널, 1/2 해상도
        self.conv2 = vgg.features[5:10]   # 128채널, 1/4 해상도
        self.conv3 = vgg.features[10:19]  # 256채널, 1/8 해상도
        self.conv4 = vgg.features[19:28]  # 512채널, 1/16 해상도
        self.conv5 = vgg.features[28:37]  # 512채널, 1/32 해상도
        
    def forward(self, x):
        """
        Args:
            x: [B, 3, H, W] 입력 이미지
            
        Returns:
            c5: 공유 특징맵 [B, 512, H/32, W/32]
            skip_connections: 스킵 연결용 중간 특징맵들
        """
        c1 = self.conv1(x)   # [B, 64, H/2, W/2]
        c2 = self.conv2(c1)  # [B, 128, H/4, W/4]
        c3 = self.conv3(c2)  # [B, 256, H/8, W/8]
        c4 = self.conv4(c3)  # [B, 512, H/16, W/16]
        c5 = self.conv5(c4)  # [B, 512, H/32, W/32]
        
        return c5, [c1, c2, c3, c4]
```

#### B. Dual Decoder (이중 디코더)

```python
class TableDetectionDecoder(nn.Module):
    """표 영역 감지 디코더"""
    
    def __init__(self):
        super().__init__()
        # 점진적 업샘플링 + 채널 축소
        self.conv1 = nn.Conv2d(512, 512, kernel_size=1)
        self.bn1 = nn.BatchNorm2d(512)
        
        self.conv2 = nn.Conv2d(512, 256, kernel_size=1)
        self.bn2 = nn.BatchNorm2d(256)
        
        self.conv3 = nn.Conv2d(256, 128, kernel_size=1)
        self.bn3 = nn.BatchNorm2d(128)
        
        # 최종 출력: 2채널 (표/배경)
        self.conv_out = nn.Conv2d(128, 2, kernel_size=1)
        
    def forward(self, shared_features):
        """
        Args:
            shared_features: [B, 512, H/32, W/32]
            
        Returns:
            [B, 2, H/4, W/4] 표 마스크 예측
        """
        x = F.relu(self.bn1(self.conv1(shared_features)))
        x = F.interpolate(x, scale_factor=2, mode='bilinear', align_corners=True)
        
        x = F.relu(self.bn2(self.conv2(x)))
        x = F.interpolate(x, scale_factor=2, mode='bilinear', align_corners=True)
        
        x = F.relu(self.bn3(self.conv3(x)))
        x = F.interpolate(x, scale_factor=2, mode='bilinear', align_corners=True)
        
        return self.conv_out(x)


class ColumnDetectionDecoder(nn.Module):
    """열 영역 감지 디코더 (구조 동일)"""
    
    def __init__(self):
        super().__init__()
        self.conv1 = nn.Conv2d(512, 512, kernel_size=1)
        self.bn1 = nn.BatchNorm2d(512)
        
        self.conv2 = nn.Conv2d(512, 256, kernel_size=1)
        self.bn2 = nn.BatchNorm2d(256)
        
        self.conv3 = nn.Conv2d(256, 128, kernel_size=1)
        self.bn3 = nn.BatchNorm2d(128)
        
        self.conv_out = nn.Conv2d(128, 2, kernel_size=1)
        
    def forward(self, shared_features):
        x = F.relu(self.bn1(self.conv1(shared_features)))
        x = F.interpolate(x, scale_factor=2, mode='bilinear', align_corners=True)
        
        x = F.relu(self.bn2(self.conv2(x)))
        x = F.interpolate(x, scale_factor=2, mode='bilinear', align_corners=True)
        
        x = F.relu(self.bn3(self.conv3(x)))
        x = F.interpolate(x, scale_factor=2, mode='bilinear', align_corners=True)
        
        return self.conv_out(x)
```

#### C. 전체 모델

```python
class TableNet(nn.Module):
    """TableNet 전체 모델"""
    
    def __init__(self, pretrained=True):
        super().__init__()
        self.encoder = TableNetEncoder(pretrained=pretrained)
        self.table_decoder = TableDetectionDecoder()
        self.column_decoder = ColumnDetectionDecoder()
        
    def forward(self, x):
        """
        Args:
            x: [B, 3, H, W] 입력 이미지
            
        Returns:
            table_mask: [B, 2, H/4, W/4] 표 마스크
            column_mask: [B, 2, H/4, W/4] 열 마스크
        """
        shared_features, _ = self.encoder(x)
        
        table_mask = self.table_decoder(shared_features)
        column_mask = self.column_decoder(shared_features)
        
        return table_mask, column_mask
```

#### D. 손실 함수

```python
class TableNetLoss(nn.Module):
    """TableNet 손실 함수"""
    
    def __init__(self, table_weight=1.0, column_weight=1.0):
        super().__init__()
        self.table_weight = table_weight
        self.column_weight = column_weight
        self.bce = nn.BCEWithLogitsLoss()
        
    def dice_loss(self, pred, target, smooth=1e-6):
        """Dice Loss - 클래스 불균형 처리"""
        pred = torch.sigmoid(pred)
        
        # Flatten
        pred_flat = pred.view(-1)
        target_flat = target.view(-1)
        
        intersection = (pred_flat * target_flat).sum()
        union = pred_flat.sum() + target_flat.sum()
        
        return 1 - (2 * intersection + smooth) / (union + smooth)
    
    def forward(self, table_pred, column_pred, table_gt, column_gt):
        """
        Args:
            table_pred: [B, 2, H, W] 표 예측
            column_pred: [B, 2, H, W] 열 예측
            table_gt: [B, 2, H, W] 표 정답
            column_gt: [B, 2, H, W] 열 정답
        """
        # 표 감지 손실 (BCE + Dice)
        table_bce = self.bce(table_pred, table_gt)
        table_dice = self.dice_loss(table_pred[:, 1], table_gt[:, 1])  # 표 클래스
        table_loss = table_bce + table_dice
        
        # 열 감지 손실
        column_bce = self.bce(column_pred, column_gt)
        column_dice = self.dice_loss(column_pred[:, 1], column_gt[:, 1])
        column_loss = column_bce + column_dice
        
        return self.table_weight * table_loss + self.column_weight * column_loss
```

### 1.4 학습 데이터 형식

```
데이터셋 구조:
├── images/
│   ├── doc_001.png
│   ├── doc_002.png
│   └── ...
├── table_masks/
│   ├── doc_001.png  (표 영역 = 255, 배경 = 0)
│   └── ...
└── column_masks/
    ├── doc_001.png  (열 영역 = 255, 배경 = 0)
    └── ...

이미지 크기: 1024x1024 (권장) 또는 가변
마스크 형식: 단일 채널 PNG (0 또는 255)
```

---

## 2. TabStruct-Net 모델

### 2.1 개요

**TabStruct-Net**은 2020년 발표된 모델로, 표의 **구조적 관계(행/열 연결성)**를 그래프로 모델링하여 복잡한 표 구조를 인식합니다.

**논문**: "TabStruct-Net: Table Structure Recognition Using Graph Neural Networks"

### 2.2 작동 매커니즘

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                      TabStruct-Net Architecture                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   입력: 표 이미지 + 셀 위치 정보 (OCR 결과)                                   │
│                     │                                                        │
│                     ▼                                                        │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                Stage 1: Cell Feature Extraction                      │    │
│  │  ┌──────────────────────────────────────────────────────────────┐   │    │
│  │  │  각 셀 영역에 대해:                                            │   │    │
│  │  │   - Visual Features: CNN으로 셀 이미지 특징 추출               │   │    │
│  │  │   - Spatial Features: [x, y, w, h, aspect_ratio]              │   │    │
│  │  │   - Textual Features: 셀 텍스트 임베딩 (선택적)                │   │    │
│  │  └──────────────────────────────────────────────────────────────┘   │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                     │                                                        │
│                     ▼                                                        │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                Stage 2: Graph Construction                           │    │
│  │                                                                      │    │
│  │   셀들을 노드로, 인접 관계를 엣지로 하는 그래프 구성                    │    │
│  │                                                                      │    │
│  │   ┌─────┐     ┌─────┐     ┌─────┐                                   │    │
│  │   │Cell1│────▶│Cell2│────▶│Cell3│    ← 수평 엣지 (같은 행 후보)      │    │
│  │   └──┬──┘     └──┬──┘     └──┬──┘                                   │    │
│  │      │           │           │                                       │    │
│  │      ▼           ▼           ▼                                       │    │
│  │   ┌─────┐     ┌─────┐     ┌─────┐    ← 수직 엣지 (같은 열 후보)      │    │
│  │   │Cell4│────▶│Cell5│────▶│Cell6│                                   │    │
│  │   └─────┘     └─────┘     └─────┘                                   │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                     │                                                        │
│                     ▼                                                        │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                Stage 3: Graph Neural Network                         │    │
│  │                                                                      │    │
│  │  ┌──────────────────────────────────────────────────────────────┐   │    │
│  │  │  Message Passing (여러 레이어 반복):                           │   │    │
│  │  │                                                                │   │    │
│  │  │  h_i^(l+1) = σ(W · AGGREGATE({h_j^(l) : j ∈ N(i)}))          │   │    │
│  │  │                                                                │   │    │
│  │  │  - 각 노드가 이웃 노드의 정보를 집계                            │   │    │
│  │  │  - 행/열 관계 정보가 전파됨                                    │   │    │
│  │  └──────────────────────────────────────────────────────────────┘   │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                     │                                                        │
│                     ▼                                                        │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                Stage 4: Edge Classification                          │    │
│  │                                                                      │    │
│  │  각 엣지에 대해 4가지 관계 분류:                                      │    │
│  │   - same_row: 같은 행에 속함                                         │    │
│  │   - same_col: 같은 열에 속함                                         │    │
│  │   - row_header: 행 헤더 관계                                         │    │
│  │   - col_header: 열 헤더 관계                                         │    │
│  │                                                                      │    │
│  │  e_ij = MLP(concat(h_i, h_j, |h_i - h_j|, h_i ⊙ h_j))              │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                     │                                                        │
│                     ▼                                                        │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                Stage 5: Table Structure Reconstruction               │    │
│  │                                                                      │    │
│  │  분류된 엣지 정보로 표 구조 복원:                                     │    │
│  │   - same_row 엣지로 연결된 셀들 → 같은 행                            │    │
│  │   - same_col 엣지로 연결된 셀들 → 같은 열                            │    │
│  │   - Transitive Closure로 병합 셀 감지                                │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 2.3 핵심 구성 요소

#### A. Cell Feature Extractor

```python
import torch
import torch.nn as nn

class CellFeatureExtractor(nn.Module):
    """각 셀의 특징 벡터 추출"""
    
    def __init__(self, visual_dim=256, spatial_dim=5, output_dim=256):
        super().__init__()
        
        # Visual Feature Extractor: 작은 CNN
        self.visual_encoder = nn.Sequential(
            nn.Conv2d(3, 32, kernel_size=3, padding=1),
            nn.ReLU(),
            nn.MaxPool2d(2),
            nn.Conv2d(32, 64, kernel_size=3, padding=1),
            nn.ReLU(),
            nn.MaxPool2d(2),
            nn.Conv2d(64, 128, kernel_size=3, padding=1),
            nn.ReLU(),
            nn.AdaptiveAvgPool2d((1, 1)),
            nn.Flatten(),
            nn.Linear(128, visual_dim)
        )
        
        # Spatial Feature Encoder: 위치 정보 인코딩
        # 입력: [x_center, y_center, width, height, aspect_ratio]
        self.spatial_encoder = nn.Sequential(
            nn.Linear(spatial_dim, 64),
            nn.ReLU(),
            nn.Linear(64, 64)
        )
        
        # Feature Fusion
        self.fusion = nn.Sequential(
            nn.Linear(visual_dim + 64, output_dim),
            nn.ReLU(),
            nn.Dropout(0.2)
        )
        
    def forward(self, cell_images, cell_bboxes):
        """
        Args:
            cell_images: [N, 3, H, W] - N개 셀의 크롭된 이미지
            cell_bboxes: [N, 5] - [x_center, y_center, width, height, aspect_ratio]
            
        Returns:
            [N, output_dim] 셀 특징 벡터
        """
        visual_feat = self.visual_encoder(cell_images)  # [N, visual_dim]
        spatial_feat = self.spatial_encoder(cell_bboxes)  # [N, 64]
        
        combined = torch.cat([visual_feat, spatial_feat], dim=1)
        return self.fusion(combined)  # [N, output_dim]
```

#### B. Graph Neural Network

```python
import torch
import torch.nn as nn
import torch.nn.functional as F

# PyTorch Geometric 사용
try:
    from torch_geometric.nn import GATConv, GCNConv
    HAS_PYG = True
except ImportError:
    HAS_PYG = False
    print("Warning: torch_geometric not installed")


class TableGraphNetwork(nn.Module):
    """셀 관계 학습을 위한 GNN"""
    
    def __init__(self, node_dim=256, hidden_dim=256, num_layers=3, heads=4):
        super().__init__()
        self.num_layers = num_layers
        
        if not HAS_PYG:
            raise ImportError("torch_geometric required for GNN")
        
        # Graph Attention Network 레이어
        self.gnn_layers = nn.ModuleList()
        
        # 첫 번째 레이어
        self.gnn_layers.append(
            GATConv(node_dim, hidden_dim, heads=heads, concat=True, dropout=0.2)
        )
        
        # 중간 레이어
        for _ in range(num_layers - 2):
            self.gnn_layers.append(
                GATConv(hidden_dim * heads, hidden_dim, heads=heads, concat=True, dropout=0.2)
            )
        
        # 마지막 레이어
        self.gnn_layers.append(
            GATConv(hidden_dim * heads, hidden_dim, heads=1, concat=False, dropout=0.2)
        )
        
        # Layer Normalization
        self.layer_norms = nn.ModuleList([
            nn.LayerNorm(hidden_dim * heads if i < num_layers - 1 else hidden_dim)
            for i in range(num_layers)
        ])
        
    def forward(self, x, edge_index):
        """
        Args:
            x: [N, node_dim] - 노드 특징
            edge_index: [2, E] - 엣지 연결 정보
            
        Returns:
            [N, hidden_dim] - 업데이트된 노드 특징
        """
        for i, (layer, norm) in enumerate(zip(self.gnn_layers, self.layer_norms)):
            x = layer(x, edge_index)
            x = norm(x)
            if i < self.num_layers - 1:
                x = F.elu(x)
                x = F.dropout(x, p=0.2, training=self.training)
        
        return x
```

#### C. Edge Classifier

```python
class EdgeClassifier(nn.Module):
    """셀 쌍의 관계 분류"""
    
    def __init__(self, node_dim=256, num_classes=4):
        super().__init__()
        
        # 엣지 특징: 두 노드의 조합
        # [h_i, h_j, |h_i - h_j|, h_i ⊙ h_j] → 4 * node_dim
        self.classifier = nn.Sequential(
            nn.Linear(node_dim * 4, 512),
            nn.ReLU(),
            nn.Dropout(0.3),
            nn.Linear(512, 256),
            nn.ReLU(),
            nn.Dropout(0.3),
            nn.Linear(256, num_classes)
        )
        
        # 클래스: same_row, same_col, row_header, col_header
        self.class_names = ['same_row', 'same_col', 'row_header', 'col_header']
        
    def forward(self, node_features, edge_index):
        """
        Args:
            node_features: [N, node_dim]
            edge_index: [2, E]
            
        Returns:
            edge_predictions: [E, num_classes]
        """
        src_idx, dst_idx = edge_index
        h_i = node_features[src_idx]  # [E, node_dim]
        h_j = node_features[dst_idx]  # [E, node_dim]
        
        # 4가지 특징 조합
        edge_features = torch.cat([
            h_i,                      # 소스 노드 특징
            h_j,                      # 타겟 노드 특징
            torch.abs(h_i - h_j),     # 차이
            h_i * h_j                 # 요소별 곱
        ], dim=1)  # [E, node_dim * 4]
        
        return self.classifier(edge_features)  # [E, num_classes]
```

#### D. 전체 모델

```python
class TabStructNet(nn.Module):
    """TabStruct-Net 전체 모델"""
    
    def __init__(self, visual_dim=256, hidden_dim=256, num_gnn_layers=3, num_classes=4):
        super().__init__()
        
        self.cell_encoder = CellFeatureExtractor(
            visual_dim=visual_dim,
            output_dim=hidden_dim
        )
        
        self.gnn = TableGraphNetwork(
            node_dim=hidden_dim,
            hidden_dim=hidden_dim,
            num_layers=num_gnn_layers
        )
        
        self.edge_classifier = EdgeClassifier(
            node_dim=hidden_dim,
            num_classes=num_classes
        )
        
    def forward(self, cell_images, cell_bboxes, edge_index):
        """
        Args:
            cell_images: [N, 3, H, W] - 셀 이미지들
            cell_bboxes: [N, 5] - 셀 좌표 정보
            edge_index: [2, E] - 엣지 연결 정보
            
        Returns:
            edge_predictions: [E, num_classes] - 엣지 관계 예측
        """
        # 1. 셀 특징 추출
        cell_features = self.cell_encoder(cell_images, cell_bboxes)
        
        # 2. GNN으로 관계 학습
        updated_features = self.gnn(cell_features, edge_index)
        
        # 3. 엣지 분류
        edge_predictions = self.edge_classifier(updated_features, edge_index)
        
        return edge_predictions
```

### 2.4 학습 데이터 형식

```json
{
  "image_id": "table_001",
  "image_path": "images/table_001.png",
  "cells": [
    {
      "id": 0,
      "bbox": [10, 10, 100, 30],
      "text": "Header 1",
      "row": 0,
      "col": 0
    },
    {
      "id": 1,
      "bbox": [110, 10, 200, 30],
      "text": "Header 2",
      "row": 0,
      "col": 1
    },
    {
      "id": 2,
      "bbox": [10, 40, 100, 60],
      "text": "Cell 1",
      "row": 1,
      "col": 0
    },
    {
      "id": 3,
      "bbox": [110, 40, 200, 60],
      "text": "Cell 2",
      "row": 1,
      "col": 1
    }
  ],
  "relations": [
    {"src": 0, "dst": 1, "type": "same_row"},
    {"src": 2, "dst": 3, "type": "same_row"},
    {"src": 0, "dst": 2, "type": "same_col"},
    {"src": 1, "dst": 3, "type": "same_col"}
  ]
}
```

---

## 3. YOLO-Table 모델

### 3.1 개요

**YOLO-Table**은 YOLO(You Only Look Once) 아키텍처를 표 감지에 적용한 모델로, **실시간 표 위치 감지**에 특화되어 있습니다.

**기반**: YOLOv5/v8 커스텀 학습

### 3.2 작동 매커니즘

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       YOLO-Table Architecture                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   입력 이미지 (640x640)                                                       │
│       │                                                                      │
│       ▼                                                                      │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                    Backbone: CSPDarknet53                            │    │
│  │                                                                      │    │
│  │   입력 ──▶ Focus ──▶ CBL ──▶ CSP1 ──▶ CSP2 ──▶ CSP3 ──▶ SPP         │    │
│  │                           │         │         │                      │    │
│  │                           │         │         │                      │    │
│  │                     (P3, 80x80) (P4, 40x40) (P5, 20x20)              │    │
│  │                           │         │         │                      │    │
│  └───────────────────────────┼─────────┼─────────┼──────────────────────┘    │
│                              │         │         │                           │
│                              ▼         ▼         ▼                           │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                    Neck: PANet (Path Aggregation Network)            │    │
│  │                                                                      │    │
│  │              ┌──────────┐                                           │    │
│  │    P5 ──────▶│ Upsample │──────┐                                    │    │
│  │              └──────────┘      │                                    │    │
│  │                                ▼                                    │    │
│  │              ┌──────────┐  ┌───────┐                                │    │
│  │    P4 ──────▶│  Concat  │◀─│       │                                │    │
│  │              └──────────┘  └───────┘                                │    │
│  │                    │                                                │    │
│  │                    ▼                                                │    │
│  │              ┌──────────┐                                           │    │
│  │              │ Upsample │──────┐                                    │    │
│  │              └──────────┘      │                                    │    │
│  │                                ▼                                    │    │
│  │              ┌──────────┐  ┌───────┐                                │    │
│  │    P3 ──────▶│  Concat  │◀─│       │                                │    │
│  │              └──────────┘  └───────┘                                │    │
│  │                    │                                                │    │
│  │                    ▼                                                │    │
│  │       N3 (80x80), N4 (40x40), N5 (20x20) 특징맵                      │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                              │                                               │
│                              ▼                                               │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                    Head: Detection Heads                             │    │
│  │                                                                      │    │
│  │  각 스케일(N3, N4, N5)에서 독립적으로 예측:                            │    │
│  │                                                                      │    │
│  │  ┌─────────────────────────────────────────────────────────────┐    │    │
│  │  │ 각 그리드 셀 (예: 80x80 = 6400개)에서:                        │    │    │
│  │  │                                                              │    │    │
│  │  │   예측 = [x, y, w, h, objectness, class_prob]                │    │    │
│  │  │                                                              │    │    │
│  │  │   - x, y: 바운딩 박스 중심 좌표 (그리드 내 오프셋)             │    │    │
│  │  │   - w, h: 바운딩 박스 너비, 높이 (앵커 박스 대비 비율)         │    │    │
│  │  │   - objectness: 객체 존재 확률                                │    │    │
│  │  │   - class_prob: 클래스 확률 (table, cell, row, column 등)     │    │    │
│  │  └─────────────────────────────────────────────────────────────┘    │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                              │                                               │
│                              ▼                                               │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                    Post-Processing: NMS                              │    │
│  │                                                                      │    │
│  │  1. Objectness 임계값 이상인 예측만 필터링                           │    │
│  │  2. Non-Maximum Suppression으로 중복 박스 제거                       │    │
│  │  3. IoU 기반 박스 병합                                              │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                              │                                               │
│                              ▼                                               │
│                    출력: [class, x, y, w, h, confidence]                     │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 3.3 핵심 구성 요소

#### A. CSP 블록 (Cross Stage Partial)

```python
import torch
import torch.nn as nn

class ConvBNSiLU(nn.Module):
    """Conv + BatchNorm + SiLU 블록"""
    
    def __init__(self, in_channels, out_channels, kernel_size=3, stride=1, padding=1):
        super().__init__()
        self.conv = nn.Conv2d(in_channels, out_channels, kernel_size, stride, padding, bias=False)
        self.bn = nn.BatchNorm2d(out_channels)
        self.act = nn.SiLU(inplace=True)
        
    def forward(self, x):
        return self.act(self.bn(self.conv(x)))


class BottleneckBlock(nn.Module):
    """Bottleneck 블록"""
    
    def __init__(self, in_channels, out_channels, shortcut=True):
        super().__init__()
        self.conv1 = ConvBNSiLU(in_channels, out_channels, kernel_size=1, padding=0)
        self.conv2 = ConvBNSiLU(out_channels, out_channels, kernel_size=3, padding=1)
        self.shortcut = shortcut and in_channels == out_channels
        
    def forward(self, x):
        out = self.conv2(self.conv1(x))
        return x + out if self.shortcut else out


class CSPBlock(nn.Module):
    """Cross Stage Partial Block - 그래디언트 정보 보존"""
    
    def __init__(self, in_channels, out_channels, num_blocks=3):
        super().__init__()
        hidden_channels = out_channels // 2
        
        # Part 1: 직접 연결
        self.part1 = ConvBNSiLU(in_channels, hidden_channels, kernel_size=1, padding=0)
        
        # Part 2: 여러 블록 통과
        self.part2_first = ConvBNSiLU(in_channels, hidden_channels, kernel_size=1, padding=0)
        
        self.blocks = nn.Sequential(*[
            BottleneckBlock(hidden_channels, hidden_channels)
            for _ in range(num_blocks)
        ])
        
        # 결합
        self.concat_conv = ConvBNSiLU(hidden_channels * 2, out_channels, kernel_size=1, padding=0)
        
    def forward(self, x):
        part1 = self.part1(x)
        part2 = self.blocks(self.part2_first(x))
        return self.concat_conv(torch.cat([part1, part2], dim=1))
```

#### B. Detection Head

```python
class YOLOTableHead(nn.Module):
    """표 감지용 YOLO Head"""
    
    def __init__(self, in_channels, num_classes=4, num_anchors=3):
        super().__init__()
        # 클래스: table, bordered_table, borderless_table, cell
        self.num_classes = num_classes
        self.num_anchors = num_anchors
        
        # 출력 채널: anchors × (5 + num_classes)
        # 5 = [x, y, w, h, objectness]
        out_channels = num_anchors * (5 + num_classes)
        
        self.conv = nn.Sequential(
            ConvBNSiLU(in_channels, in_channels * 2, kernel_size=3, padding=1),
            nn.Conv2d(in_channels * 2, out_channels, kernel_size=1)
        )
        
    def forward(self, x):
        """
        Args:
            x: [B, in_channels, H, W]
            
        Returns:
            [B, num_anchors, H, W, 5 + num_classes]
        """
        B, C, H, W = x.shape
        out = self.conv(x)
        
        # Reshape: [B, anchors*(5+classes), H, W] → [B, anchors, H, W, 5+classes]
        out = out.view(B, self.num_anchors, 5 + self.num_classes, H, W)
        out = out.permute(0, 1, 3, 4, 2)
        
        return out
```

#### C. 손실 함수

```python
class YOLOTableLoss(nn.Module):
    """YOLO 표 감지 손실 함수"""
    
    def __init__(self, lambda_coord=5.0, lambda_noobj=0.5, lambda_cls=1.0):
        super().__init__()
        self.lambda_coord = lambda_coord
        self.lambda_noobj = lambda_noobj
        self.lambda_cls = lambda_cls
        
        self.bce = nn.BCEWithLogitsLoss(reduction='none')
        self.mse = nn.MSELoss(reduction='none')
        
    def forward(self, predictions, targets, anchors):
        """
        Args:
            predictions: [B, anchors, H, W, 5+classes]
            targets: 그라운드 트루스 정보
            anchors: 앵커 박스 크기
            
        Returns:
            total_loss: 총 손실
        """
        # 예측 분리
        pred_xy = torch.sigmoid(predictions[..., :2])  # x, y (0~1)
        pred_wh = predictions[..., 2:4]  # w, h (log scale)
        pred_obj = predictions[..., 4:5]  # objectness
        pred_cls = predictions[..., 5:]  # class probabilities
        
        # 좌표 손실 (객체가 있는 그리드만)
        obj_mask = targets[..., 4:5]  # 객체 존재 마스크
        
        coord_loss = self.lambda_coord * obj_mask * (
            self.mse(pred_xy, targets[..., :2]) +
            self.mse(pred_wh, targets[..., 2:4])
        )
        
        # Objectness 손실
        obj_loss = self.bce(pred_obj, targets[..., 4:5])
        obj_loss = obj_mask * obj_loss + self.lambda_noobj * (1 - obj_mask) * obj_loss
        
        # 클래스 손실 (객체가 있는 그리드만)
        cls_loss = self.lambda_cls * obj_mask * self.bce(pred_cls, targets[..., 5:])
        
        total_loss = (coord_loss.sum() + obj_loss.sum() + cls_loss.sum()) / predictions.shape[0]
        
        return total_loss
```

### 3.4 YOLOv8 기반 학습 (권장)

```python
# ultralytics 라이브러리 사용 (가장 쉬운 방법)
from ultralytics import YOLO

# 모델 로드
model = YOLO('yolov8n.pt')  # 또는 yolov8s.pt, yolov8m.pt

# 커스텀 데이터셋으로 학습
results = model.train(
    data='table_dataset.yaml',  # 데이터셋 설정 파일
    epochs=100,
    imgsz=640,
    batch=16,
    name='yolo_table'
)

# 추론
results = model.predict(source='test_image.png')
```

### 3.5 학습 데이터 형식 (YOLO 포맷)

```yaml
# table_dataset.yaml
path: /path/to/dataset
train: images/train
val: images/val

names:
  0: table
  1: bordered_table
  2: borderless_table
  3: cell
```

```
# 라벨 파일 형식 (labels/image_001.txt)
# class_id  x_center  y_center  width  height (모두 0~1 정규화)
0  0.5  0.3  0.8  0.4    # 표 영역
3  0.15  0.25  0.1  0.05  # 셀 1
3  0.35  0.25  0.1  0.05  # 셀 2
```

---

## 4. 모델 비교 요약

| 특성 | TableNet | TabStruct-Net | YOLO-Table |
|:---|:---:|:---:|:---:|
| **주요 목적** | 표 영역 + 열 감지 | 셀 관계 분석 | 실시간 표 감지 |
| **입력** | 문서 이미지 | 이미지 + 셀 좌표 | 문서 이미지 |
| **출력** | 세그멘테이션 마스크 | 셀 관계 그래프 | 바운딩 박스 |
| **아키텍처** | Encoder-Decoder (FCN) | GNN | CNN + FPN |
| **장점** | 단순함, End-to-End | 복잡한 구조 처리 | 빠른 속도 |
| **단점** | 구조 정보 부족 | 사전 셀 감지 필요 | 구조 분석 불가 |
| **추론 속도** | 중간 (~100ms) | 느림 (~300ms) | 빠름 (~20ms) |
| **정확도** | 중간 | 높음 | 중간 |
| **구현 난이도** | 중간 | 높음 | 낮음 (ultralytics) |

---

## 5. 자체 구현을 위한 사전 준비

### 5.1 하드웨어 요구사항

| 구성 요소 | 최소 사양 | 권장 사양 |
|:---|:---|:---|
| **GPU** | GTX 1080 (8GB VRAM) | RTX 3090/4090 (24GB VRAM) |
| **RAM** | 16GB | 64GB |
| **저장공간** | 500GB SSD | 2TB NVMe SSD |
| **CPU** | 8코어 | 16코어+ |

### 5.2 소프트웨어 환경

```bash
# 권장 Python 환경
python >= 3.9
cuda >= 11.8
cudnn >= 8.6

# 핵심 라이브러리
pip install torch>=2.0 torchvision>=0.15
pip install torch-geometric>=2.3        # GNN용 (TabStruct-Net)
pip install ultralytics>=8.0            # YOLOv8
pip install timm>=0.9                   # 사전학습 모델
pip install albumentations>=1.3         # 데이터 증강
pip install wandb>=0.15                 # 실험 추적
pip install opencv-python>=4.8
pip install scipy>=1.11
```

### 5.3 데이터셋 준비

#### 공개 데이터셋

| 데이터셋 | 이미지 수 | 표 유형 | 특징 |
|:---|:---:|:---|:---|
| **PubTabNet** | 568,000+ | 학술 논문 표 | 가장 큰 규모, 구조 주석 포함 |
| **ICDAR-2019** | 2,000+ | 다양한 문서 | 경진대회 표준 |
| **TableBank** | 417,000+ | Word/LaTeX 표 | 다국어 지원 |
| **FinTabNet** | 90,000+ | 재무제표 | 복잡한 구조 |
| **SciTSR** | 15,000+ | 과학 논문 | 구조 주석 상세 |

#### 다운로드 링크

- **PubTabNet**: https://github.com/ibm-aur-nlp/PubTabNet
- **TableBank**: https://github.com/doc-analysis/TableBank
- **ICDAR-2019**: https://cndplab-founder.github.io/ICDAR2019_cTDaR/

#### 커스텀 데이터 어노테이션 도구

| 도구 | 형식 지원 | 특징 |
|:---|:---|:---|
| **LabelImg** | YOLO, VOC | 바운딩 박스 |
| **CVAT** | COCO, YOLO, VOC | 세그멘테이션 + 박스 |
| **Label Studio** | 다양한 형식 | 웹 기반, 팀 협업 |
| **VGG Image Annotator** | JSON | 폴리곤 주석 |

---

## 6. 필요한 기초 지식

### 6.1 수학적 기초

```
┌─────────────────────────────────────────────────────────────────┐
│                    필수 수학 개념                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. 선형대수                                                      │
│     ├─ 행렬 연산 (곱셈, 전치, 역행렬)                              │
│     ├─ 고유값/고유벡터                                            │
│     ├─ SVD (특이값 분해)                                          │
│     └─ 텐서 연산                                                  │
│                                                                  │
│  2. 미적분                                                        │
│     ├─ 편미분 (Partial Derivatives)                               │
│     ├─ 체인 룰 (Chain Rule) ← 역전파의 핵심                       │
│     ├─ 그래디언트 (Gradient)                                      │
│     └─ 야코비안 (Jacobian)                                        │
│                                                                  │
│  3. 확률/통계                                                     │
│     ├─ 베이즈 정리                                                │
│     ├─ 최대우도추정 (MLE)                                         │
│     ├─ 교차 엔트로피                                              │
│     ├─ KL Divergence                                             │
│     └─ IoU (Intersection over Union)                             │
│                                                                  │
│  4. 최적화                                                        │
│     ├─ 경사하강법 (Gradient Descent)                              │
│     ├─ SGD, Adam, AdamW                                          │
│     ├─ Learning Rate Scheduling                                  │
│     └─ 정규화 (L1, L2, Dropout)                                   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 6.2 딥러닝 핵심 개념

```
┌─────────────────────────────────────────────────────────────────┐
│                    CNN 핵심 개념                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. Convolution 연산                                             │
│     ┌─────────────────────────────────────────────────────────┐ │
│     │  Input     Kernel      Output                           │ │
│     │  [5×5]  *  [3×3]  =  [3×3]                              │ │
│     │                                                         │ │
│     │  출력 크기 = (입력 - 커널 + 2*패딩) / 스트라이드 + 1     │ │
│     └─────────────────────────────────────────────────────────┘ │
│                                                                  │
│  2. Pooling (Max, Average)                                       │
│     - 공간 해상도 축소                                            │
│     - 위치 불변성 제공                                            │
│                                                                  │
│  3. Batch Normalization                                          │
│     - 내부 공변량 이동 해결                                       │
│     - 학습 안정화                                                 │
│                                                                  │
│  4. Skip Connections (ResNet)                                    │
│     - 그래디언트 소실 방지                                        │
│     - 깊은 네트워크 학습 가능                                     │
│                                                                  │
│  5. Feature Pyramid Network (FPN)                                │
│     - 다중 스케일 특징 추출                                       │
│     - 작은 객체 감지 개선                                         │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 6.3 객체 감지 개념

```
┌─────────────────────────────────────────────────────────────────┐
│                  객체 감지 핵심 개념                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. Anchor Boxes                                                 │
│     - 사전 정의된 박스 비율                                       │
│     - 예측은 앵커 대비 오프셋으로                                 │
│                                                                  │
│  2. IoU (Intersection over Union)                                │
│                                                                  │
│           Area of Intersection                                   │
│     IoU = ─────────────────────                                  │
│             Area of Union                                        │
│                                                                  │
│  3. NMS (Non-Maximum Suppression)                                │
│     1) 신뢰도 순 정렬                                             │
│     2) 최고 신뢰도 박스 선택                                      │
│     3) IoU > threshold인 박스 제거                                │
│     4) 남은 박스에 대해 반복                                      │
│                                                                  │
│  4. mAP (mean Average Precision)                                 │
│     - Precision-Recall 곡선 아래 면적                             │
│     - IoU 임계값별 AP의 평균                                      │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 6.4 GNN (Graph Neural Network) 기초

```
┌─────────────────────────────────────────────────────────────────┐
│                    GNN 핵심 개념                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. 그래프 표현                                                   │
│     G = (V, E)                                                   │
│     V: 노드 집합 (셀들)                                          │
│     E: 엣지 집합 (셀 간 관계)                                    │
│                                                                  │
│  2. Message Passing                                              │
│                                                                  │
│     h_i^(l+1) = UPDATE(h_i^(l), AGGREGATE({h_j^(l) : j ∈ N(i)}))│
│                                                                  │
│     - 각 노드가 이웃으로부터 정보 수집                            │
│     - 여러 레이어 거치며 원거리 정보 전파                         │
│                                                                  │
│  3. GNN 변종                                                      │
│     - GCN (Graph Convolutional Network)                          │
│     - GAT (Graph Attention Network) ← TabStruct-Net 사용         │
│     - GraphSAGE                                                  │
│                                                                  │
│  4. 엣지 분류                                                     │
│     - 두 노드의 특징을 결합하여 관계 예측                         │
│     - e_ij = MLP(h_i || h_j || f(h_i, h_j))                      │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 7. 학습 로드맵 (권장 순서)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         학습 로드맵                                          │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Phase 1: 기초 (2-3개월)                                                     │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │ □ Python 프로그래밍 숙달                                                │ │
│  │ □ NumPy, Pandas 기초                                                   │ │
│  │ □ 선형대수/미적분 복습                                                  │ │
│  │ □ 머신러닝 기초 (Scikit-learn)                                         │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                           │                                                  │
│                           ▼                                                  │
│  Phase 2: 딥러닝 입문 (2-3개월)                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │ □ PyTorch 기초 (텐서, 자동미분)                                         │ │
│  │ □ MLP, CNN 구현                                                        │ │
│  │ □ 이미지 분류 프로젝트 (MNIST, CIFAR-10)                                │ │
│  │ □ 전이학습 (Transfer Learning)                                         │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                           │                                                  │
│                           ▼                                                  │
│  Phase 3: 컴퓨터 비전 심화 (2-3개월)                                         │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │ □ 객체 감지 (YOLO, Faster R-CNN)                                       │ │
│  │ □ 세그멘테이션 (U-Net, FCN)                                            │ │
│  │ □ 데이터 증강 기법                                                     │ │
│  │ □ mAP, IoU 등 평가 지표 이해                                           │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                           │                                                  │
│                           ▼                                                  │
│  Phase 4: 고급 주제 (2-3개월)                                                │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │ □ GNN (Graph Neural Networks)                                          │ │
│  │ □ Attention Mechanism                                                  │ │
│  │ □ Multi-task Learning                                                  │ │
│  │ □ 표 감지 논문 구현 (TableNet, TabStruct-Net)                          │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                           │                                                  │
│                           ▼                                                  │
│  Phase 5: 실전 프로젝트 (지속)                                               │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │ □ 커스텀 데이터셋 구축                                                  │ │
│  │ □ 모델 학습 및 하이퍼파라미터 튜닝                                      │ │
│  │ □ 모델 배포 (ONNX, TensorRT)                                           │ │
│  │ □ 성능 최적화                                                          │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 8. 추천 학습 자료

### 8.1 서적

| 분야 | 서적명 | 저자 | 특징 |
|:---|:---|:---|:---|
| **딥러닝 기초** | Deep Learning | Ian Goodfellow | 이론 바이블 |
| **딥러닝 기초** | 밑바닥부터 시작하는 딥러닝 | 사이토 고키 | 구현 중심 |
| **PyTorch** | PyTorch로 시작하는 딥러닝 | 오가와 유타로 | 실습 중심 |
| **컴퓨터 비전** | Deep Learning for Computer Vision | Rajalingappaa | 객체 감지 상세 |
| **GNN** | Graph Representation Learning | William Hamilton | GNN 이론 |
| **수학** | Mathematics for Machine Learning | Deisenroth | ML 수학 전반 |

### 8.2 온라인 강의

#### 무료 강의

| 강의명 | 플랫폼 | 강사 | 특징 |
|:---|:---|:---|:---|
| **CS231n** | Stanford (YouTube) | Fei-Fei Li | CNN 최고 강의 |
| **CS224W** | Stanford (YouTube) | Jure Leskovec | GNN 전문 |
| **Deep Learning Specialization** | Coursera | Andrew Ng | 체계적 입문 |
| **Fast.ai** | fast.ai | Jeremy Howard | 실용적 접근 |
| **PyTorch Tutorials** | pytorch.org | Official | 공식 튜토리얼 |

#### 유료 강의 (한국어)

| 강의명 | 플랫폼 | 특징 |
|:---|:---|:---|
| **모두를 위한 딥러닝** | 인프런 | 기초 입문 |
| **PyTorch로 배우는 딥러닝** | 패스트캠퍼스 | 실습 중심 |
| **컴퓨터 비전 완벽 가이드** | 인프런 | 객체 감지 포함 |

### 8.3 핵심 논문

#### 표 감지/인식

| 논문 | 연도 | 핵심 기여 | 링크 |
|:---|:---:|:---|:---|
| **TableNet** | 2019 | 듀얼 디코더 구조 | arXiv:1903.01949 |
| **TabStruct-Net** | 2020 | GNN 기반 구조 인식 | ECCV 2020 |
| **DETR for Tables** | 2021 | Transformer 적용 | - |
| **TableFormer** | 2022 | End-to-End 구조 인식 | arXiv:2203.01017 |
| **Table Transformer** | 2022 | MS Research, SOTA | arXiv:2110.00061 |

#### 기반 기술

| 논문 | 연도 | 핵심 기여 |
|:---|:---:|:---|
| **VGGNet** | 2014 | 깊은 CNN |
| **ResNet** | 2015 | Skip Connection |
| **U-Net** | 2015 | 세그멘테이션 기준 |
| **YOLO** | 2016 | 실시간 객체 감지 |
| **FPN** | 2017 | 다중 스케일 특징 |
| **Graph Attention Networks** | 2018 | Attention in GNN |

### 8.4 GitHub 레포지토리

| 레포지토리 | 내용 | 링크 |
|:---|:---|:---|
| **ultralytics/yolov8** | YOLOv8 공식 | github.com/ultralytics/ultralytics |
| **microsoft/table-transformer** | Table Transformer | github.com/microsoft/table-transformer |
| **doc-analysis/TableBank** | TableBank 데이터셋 | github.com/doc-analysis/TableBank |
| **ibm-aur-nlp/PubTabNet** | PubTabNet 데이터셋 | github.com/ibm-aur-nlp/PubTabNet |
| **pyg-team/pytorch_geometric** | PyTorch GNN | github.com/pyg-team/pytorch_geometric |
| **open-mmlab/mmdetection** | 객체 감지 툴박스 | github.com/open-mmlab/mmdetection |

### 8.5 YouTube 채널

| 채널 | 특징 | 언어 |
|:---|:---|:---|
| **Yannic Kilcher** | 최신 논문 리뷰 | 영어 |
| **Two Minute Papers** | 연구 트렌드 요약 | 영어 |
| **StatQuest** | 통계/ML 기초 | 영어 |
| **빵형의 개발도상국** | AI/ML 한국어 | 한국어 |
| **혁펜하임** | 딥러닝 강의 | 한국어 |

---

## 9. 실습 프로젝트 제안

### 9.1 단계별 프로젝트

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                      실습 프로젝트 로드맵                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Project 1: MNIST 표 감지 (입문)                                             │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │ - 합성 표 이미지 생성 (PIL/OpenCV)                                      │ │
│  │ - 단순 CNN으로 표 영역 분류                                             │ │
│  │ - 평가: Accuracy, IoU                                                  │ │
│  │ - 예상 기간: 1-2주                                                     │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                           │                                                  │
│                           ▼                                                  │
│  Project 2: YOLOv8 표 감지 (중급)                                            │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │ - PubTabNet/TableBank 데이터셋 사용                                     │ │
│  │ - YOLOv8 커스텀 학습                                                   │ │
│  │ - 평가: mAP@50, mAP@50:95                                              │ │
│  │ - 예상 기간: 2-3주                                                     │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                           │                                                  │
│                           ▼                                                  │
│  Project 3: TableNet 구현 (중급)                                             │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │ - VGG-19 인코더 + 듀얼 디코더 구현                                      │ │
│  │ - 표 마스크 + 열 마스크 동시 학습                                       │ │
│  │ - 평가: Pixel Accuracy, mIoU                                           │ │
│  │ - 예상 기간: 3-4주                                                     │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                           │                                                  │
│                           ▼                                                  │
│  Project 4: GNN 기반 구조 인식 (고급)                                        │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │ - 셀 특징 추출기 구현                                                   │ │
│  │ - GAT 기반 관계 학습                                                   │ │
│  │ - 엣지 분류 (same_row, same_col)                                       │ │
│  │ - 평가: Edge F1-Score                                                  │ │
│  │ - 예상 기간: 4-6주                                                     │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                           │                                                  │
│                           ▼                                                  │
│  Project 5: 통합 파이프라인 (고급)                                           │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │ - YOLO(표 감지) + TableNet(열 감지) + GNN(구조) 통합                    │ │
│  │ - PDF → 표 추출 → 구조 복원 → 마크다운/JSON 출력                        │ │
│  │ - End-to-End 평가                                                      │ │
│  │ - 예상 기간: 6-8주                                                     │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 9.2 Quick Start: YOLOv8 표 감지

```python
# 가장 빠르게 시작할 수 있는 방법

# 1. 설치
# pip install ultralytics

# 2. 데이터셋 준비 (YOLO 형식)
"""
dataset/
├── images/
│   ├── train/
│   │   ├── img_001.jpg
│   │   └── ...
│   └── val/
│       ├── img_100.jpg
│       └── ...
├── labels/
│   ├── train/
│   │   ├── img_001.txt  # class x_center y_center width height
│   │   └── ...
│   └── val/
│       └── ...
└── data.yaml
"""

# 3. data.yaml 작성
"""
path: /path/to/dataset
train: images/train
val: images/val

names:
  0: table
"""

# 4. 학습
from ultralytics import YOLO

model = YOLO('yolov8n.pt')  # nano 모델 (가장 빠름)

results = model.train(
    data='data.yaml',
    epochs=50,
    imgsz=640,
    batch=16,
    device=0  # GPU 0
)

# 5. 추론
model = YOLO('runs/detect/train/weights/best.pt')
results = model.predict('test_document.png', save=True)

# 결과 확인
for result in results:
    boxes = result.boxes
    for box in boxes:
        print(f"Class: {box.cls}, Confidence: {box.conf}, BBox: {box.xyxy}")
```

---

## 문서 정보

- **버전**: 1.0
- **작성일**: 2026-01-27
- **작성자**: PDF OCR 프로젝트 팀
- **관련 문서**: PDFTableRestore.md
