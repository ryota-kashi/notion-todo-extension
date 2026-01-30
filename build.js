const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, 'src');
const assetsDir = path.join(__dirname, 'assets');
const distDir = path.join(__dirname, 'dist');

console.log('🔨 ビルド開始...');

// distディレクトリをクリア
if (fs.existsSync(distDir)) {
  fs.rmSync(distDir, { recursive: true });
  console.log('✓ 既存のdist/フォルダを削除');
}

// distディレクトリを作成
fs.mkdirSync(distDir, { recursive: true });

// ディレクトリを再帰的にコピー
function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

// srcをdistにコピー
console.log('📦 src/をdist/にコピー中...');
copyDir(srcDir, distDir);
console.log('✓ src/のコピー完了');

// assetsのiconsをdist/iconsにコピー
const distIconsDir = path.join(distDir, 'icons');
const srcIconsDir = path.join(assetsDir, 'icons');

if (fs.existsSync(srcIconsDir)) {
  console.log('🎨 assets/icons/をdist/icons/にコピー中...');
  copyDir(srcIconsDir, distIconsDir);
  console.log('✓ アイコンのコピー完了');
}

// manifest.jsonのアイコンパスを修正
const manifestPath = path.join(distDir, 'manifest.json');
if (fs.existsSync(manifestPath)) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  
  // アイコンパスを修正
  if (manifest.icons) {
    manifest.icons = {
      "16": "icons/icon16.png",
      "48": "icons/icon48.png",
      "128": "icons/icon128.png"
    };
  }
  
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log('✓ manifest.jsonのパスを修正');
}

console.log('\n✅ ビルド完了!');
console.log('📁 dist/フォルダをChromeに読み込んでください\n');
