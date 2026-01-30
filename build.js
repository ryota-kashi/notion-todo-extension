const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, 'src');
const assetsIconsDir = path.join(__dirname, 'assets', 'icons');
const distDir = path.join(__dirname, 'dist');

console.log('🔨 ビルド開始...');

// distディレクトリをクリア
if (fs.existsSync(distDir)) {
  fs.rmSync(distDir, { recursive: true });
  console.log('✓ 既存のdist/フォルダを削除');
}

// distディレクトリを作成
fs.mkdirSync(distDir, { recursive: true });

// srcのファイルをdist直下にコピー
console.log('📦 src/のファイルをdist/にコピー中...');
const srcFiles = fs.readdirSync(srcDir);
for (const file of srcFiles) {
  const srcPath = path.join(srcDir, file);
  const destPath = path.join(distDir, file);
  
  // ファイルのみコピー(ディレクトリは無視)
  if (fs.statSync(srcPath).isFile()) {
    fs.copyFileSync(srcPath, destPath);
  }
}
console.log('✓ src/のコピー完了');

// assets/iconsのファイルをdist/icons/にコピー
if (fs.existsSync(assetsIconsDir)) {
  console.log('🎨 assets/icons/のファイルをdist/icons/にコピー中...');
  const distIconsDir = path.join(distDir, 'icons');
  fs.mkdirSync(distIconsDir, { recursive: true });
  
  const iconFiles = fs.readdirSync(assetsIconsDir);
  for (const file of iconFiles) {
    const srcPath = path.join(assetsIconsDir, file);
    const destPath = path.join(distIconsDir, file);
    
    if (fs.statSync(srcPath).isFile()) {
      fs.copyFileSync(srcPath, destPath);
    }
  }
  console.log('✓ アイコンのコピー完了');
}

console.log('\n✅ ビルド完了!');
console.log('📁 dist/フォルダをChromeに読み込んでください\n');
