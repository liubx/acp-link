#!/bin/bash
set -e

echo "📦 构建前端..."
cd web && npm run build && cd ..

echo "🦀 构建 Rust (release)..."
cargo build --release

echo "📋 安装到 /usr/local/bin..."
sudo cp target/release/acp-link /usr/local/bin/acp-link
sudo codesign --force -s - /usr/local/bin/acp-link

echo "🔄 重启服务..."
pkill -9 -x acp-link || true

echo "✅ 完成"
