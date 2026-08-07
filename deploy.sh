#!/bin/bash
# 星屿乐园 · 一键推送并触发部署
# 用法：./deploy.sh
set -e
cd "$(dirname "$0")"

echo "→ 检查 Git 状态..."
if ! git diff-index --quiet HEAD -- 2>/dev/null; then
  echo "  有未提交改动，请先 commit 或 stash"
  git status -sb
  exit 1
fi

if ! git remote get-url origin &>/dev/null; then
  echo ""
  echo "尚未配置 GitHub 远程仓库。请先在浏览器创建空仓库："
  echo "  https://github.com/new  （名称建议：stellar-park，不要勾选 README）"
  echo ""
  read -r -p "输入你的 GitHub 用户名: " GH_USER
  git remote add origin "https://github.com/${GH_USER}/stellar-park.git"
  echo "  已添加 origin → https://github.com/${GH_USER}/stellar-park.git"
fi

echo "→ 推送到 GitHub..."
git push -u origin main

echo ""
echo "✓ 推送完成。"
echo ""
echo "接下来任选一种方式完成在线部署："
echo ""
echo "【推荐】Vercel + GitHub 自动更新"
echo "  1. 打开 https://vercel.com/new"
echo "  2. Import 仓库 stellar-park"
echo "  3. Framework 选 Other，Build 留空，Deploy"
echo "  4. 以后改代码 → git push → 链接自动更新"
echo ""
echo "【备选】GitHub Pages"
echo "  1. 仓库 Settings → Pages → Source 选 GitHub Actions"
echo "  2. push 后 Actions 会自动部署"
echo "  3. 地址：https://${GH_USER:-你的用户名}.github.io/stellar-park/"
echo ""
