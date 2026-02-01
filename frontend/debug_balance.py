
import re
import os

def check_balance(filename):
    print(f"Checking file: {filename}")
    if not os.path.exists(filename):
        print("File not found!")
        return

    with open(filename, 'r', encoding='utf-8') as f:
        lines = f.readlines()

    stack = []
    # 894번 줄부터 검사 (TextExtractionPage 함수 시작)
    # 실제 파일에서는 0-based index이므로 893
    start_line = 893 
    
    in_block_comment = False

    for i, line in enumerate(lines):
        # 함수 시작 전은 건너뛰되, 파일 전체 구조를 보는게 나을수도 있음.
        # 일단 요청대로 함수 시작부터 봄.
        if i < start_line:
            continue
            
        # 한 줄 처리
        idx = 0
        while idx < len(line):
            char = line[idx]
            
            # 블록 주석 처리
            if in_block_comment:
                if line[idx:idx+2] == '*/':
                    in_block_comment = False
                    idx += 1
                idx += 1
                continue
            
            if line[idx:idx+2] == '/*':
                in_block_comment = True
                idx += 2
                continue
                
            if line[idx:idx+2] == '//':
                break # 라인 끝까지 주석
                
            # 문자열 처리는 간단하게 (이스케이프 무시)
            # 여기서는 복잡성을 피하기 위해 문자열 내 괄호는 무시하지 않음 (JSX 특성상 어려움)
            # 하지만 대부분의 에러는 코드 블록 {} () 에서 발생하므로, 
            # 일반적인 코드 라인에서의 괄호만 추적.
            
            if char in '{(':
                stack.append((char, i + 1))
            elif char in '})':
                if not stack:
                    print(f"Error: Extra '{char}' at line {i + 1}")
                    return
                
                last_open, last_line = stack.pop()
                expected_close = '}' if last_open == '{' else ')'
                
                if char != expected_close:
                    print(f"Error: Mismatched '{last_open}' (from line {last_line}) and '{char}' at line {i + 1}")
                    # return # 계속 진행해서 더 많은 오류 보기

            idx += 1

    if stack:
        print(f"Error: Unclosed parentheses/braces remaining: {len(stack)}")
        for char, line_num in stack: 
            print(f"Unclosed '{char}' from line {line_num}")

# 현재 작업 디렉토리 기준 상대 경로
check_balance('app/(app)/processing/extract/page.tsx')
