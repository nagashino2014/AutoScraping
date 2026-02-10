/**
 * 우편번호 txt 파일들을 SQLite DB로 변환하는 스크립트
 * 
 * 실행: node scripts/convert-zipcode-to-sqlite.js
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const Database = require('better-sqlite3');

const ZIPCODE_DIR = path.join(__dirname, '../public/ZipCode');
const DB_PATH = path.join(__dirname, '../data/zipcode.db');

// 데이터 디렉토리 확인
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// 기존 DB 삭제
if (fs.existsSync(DB_PATH)) {
  fs.unlinkSync(DB_PATH);
  console.log('기존 DB 삭제됨');
}

// SQLite DB 생성
const db = new Database(DB_PATH);

// 테이블 생성
db.exec(`
  CREATE TABLE IF NOT EXISTS addresses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    zip_code TEXT NOT NULL,
    sido TEXT NOT NULL,
    sigungu TEXT,
    eupmyeon TEXT,
    road_name TEXT,
    building_num_main TEXT,
    building_num_sub TEXT,
    building_name TEXT,
    dong_name TEXT,
    ri_name TEXT,
    jibun_main TEXT,
    jibun_sub TEXT,
    is_underground INTEGER DEFAULT 0,
    is_mountain INTEGER DEFAULT 0
  );
`);

// 인덱스 생성은 데이터 삽입 후에 (더 빠름)
console.log('테이블 생성 완료');

// 삽입 prepared statement
const insertStmt = db.prepare(`
  INSERT INTO addresses (
    zip_code, sido, sigungu, eupmyeon, road_name,
    building_num_main, building_num_sub, building_name,
    dong_name, ri_name, jibun_main, jibun_sub,
    is_underground, is_mountain
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

// 배치 삽입을 위한 트랜잭션
const insertMany = db.transaction((rows) => {
  for (const row of rows) {
    insertStmt.run(...row);
  }
});

async function processFile(filePath, fileName) {
  return new Promise((resolve, reject) => {
    const fileStream = fs.createReadStream(filePath, { encoding: 'utf-8' });
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity,
    });

    let isFirstLine = true;
    let rows = [];
    let totalCount = 0;
    const BATCH_SIZE = 10000;

    rl.on('line', (line) => {
      if (isFirstLine) {
        isFirstLine = false;
        return;
      }

      const parts = line.split('|');
      if (parts.length < 24) return;

      const [
        zipCode,           // 0
        sido,              // 1
        _sidoEn,           // 2
        sigungu,           // 3
        _sigunguEn,        // 4
        eupmyeon,          // 5
        _eupmyeonEn,       // 6
        _roadCode,         // 7
        roadName,          // 8
        _roadNameEn,       // 9
        isUnderground,     // 10
        buildingNumMain,   // 11
        buildingNumSub,    // 12
        _buildingMgmtNum,  // 13
        bulkDeliveryName,  // 14
        buildingName,      // 15
        _beopjungCode,     // 16
        dongName,          // 17
        riName,            // 18
        _adminDongName,    // 19
        isMountain,        // 20
        jibunMain,         // 21
        _eupmyeonSeq,      // 22
        jibunSub,          // 23
      ] = parts;

      const finalBuildingName = bulkDeliveryName || buildingName || '';

      rows.push([
        zipCode,
        sido,
        sigungu || '',
        eupmyeon || '',
        roadName || '',
        buildingNumMain || '',
        buildingNumSub || '',
        finalBuildingName,
        dongName || '',
        riName || '',
        jibunMain || '',
        jibunSub || '',
        isUnderground === '1' ? 1 : 0,
        isMountain === '1' ? 1 : 0,
      ]);

      if (rows.length >= BATCH_SIZE) {
        insertMany(rows);
        totalCount += rows.length;
        process.stdout.write(`\r  ${fileName}: ${totalCount.toLocaleString()}건 처리됨`);
        rows = [];
      }
    });

    rl.on('close', () => {
      if (rows.length > 0) {
        insertMany(rows);
        totalCount += rows.length;
      }
      console.log(`\r  ${fileName}: ${totalCount.toLocaleString()}건 완료`);
      resolve(totalCount);
    });

    rl.on('error', reject);
  });
}

async function main() {
  console.log('우편번호 데이터 SQLite 변환 시작...\n');
  const startTime = Date.now();

  const files = fs.readdirSync(ZIPCODE_DIR).filter(f => f.endsWith('.txt'));
  console.log(`처리할 파일: ${files.length}개\n`);

  let totalRecords = 0;

  for (const file of files) {
    const filePath = path.join(ZIPCODE_DIR, file);
    const count = await processFile(filePath, file);
    totalRecords += count;
  }

  console.log(`\n총 ${totalRecords.toLocaleString()}건 삽입 완료`);

  // 인덱스 생성
  console.log('\n인덱스 생성 중...');
  
  db.exec(`CREATE INDEX IF NOT EXISTS idx_road_name ON addresses(road_name)`);
  console.log('  - road_name 인덱스 완료');
  
  db.exec(`CREATE INDEX IF NOT EXISTS idx_dong_name ON addresses(dong_name)`);
  console.log('  - dong_name 인덱스 완료');
  
  db.exec(`CREATE INDEX IF NOT EXISTS idx_building_name ON addresses(building_name)`);
  console.log('  - building_name 인덱스 완료');
  
  db.exec(`CREATE INDEX IF NOT EXISTS idx_zip_code ON addresses(zip_code)`);
  console.log('  - zip_code 인덱스 완료');
  
  db.exec(`CREATE INDEX IF NOT EXISTS idx_sido ON addresses(sido)`);
  console.log('  - sido 인덱스 완료');

  // FTS (Full-Text Search) 테이블 생성
  console.log('\nFTS 검색 테이블 생성 중...');
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS addresses_fts USING fts5(
      road_name, dong_name, building_name, sigungu,
      content='addresses',
      content_rowid='id'
    );
  `);
  
  db.exec(`
    INSERT INTO addresses_fts(rowid, road_name, dong_name, building_name, sigungu)
    SELECT id, road_name, dong_name, building_name, sigungu FROM addresses;
  `);
  console.log('  - FTS 테이블 완료');

  db.close();

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const stats = fs.statSync(DB_PATH);
  const sizeMB = (stats.size / 1024 / 1024).toFixed(1);

  console.log(`\n========================================`);
  console.log(`변환 완료!`);
  console.log(`  - 소요 시간: ${elapsed}초`);
  console.log(`  - DB 파일: ${DB_PATH}`);
  console.log(`  - 파일 크기: ${sizeMB} MB`);
  console.log(`========================================`);
}

main().catch(console.error);
