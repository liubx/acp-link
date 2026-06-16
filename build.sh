#!/bin/bash
set -e

echo "📦 构建前端..."
cd web && npm run build && cd ..

echo "🦀 构建 Rust (release)..."
cargo build --release

echo "✅ 完成: target/release/acp-link"
