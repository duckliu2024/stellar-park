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
echo "【国内无 VPN 访问】不要用 vercel.app，请用下面任一方式："
echo ""
echo "  方案 A · Gitee Pages（国内最快，推荐）"
echo "    1. 打开 https://gitee.com 注册/登录"
echo "    2. 右上角 + → 从 GitHub 导入 → 填 duckliu2024/stellar-park"
echo "    3. 仓库 → 服务 → Gitee Pages → 启动"
echo "    4. 访问 https://你的用户名.gitee.io/stellar-park/"
echo ""
echo "  方案 B · GitHub Pages"
echo "    1. 打开 https://github.com/duckliu2024/stellar-park/settings/pages"
echo "    2. Source 选 Deploy from branch → main → / (root) → Save"
echo "    3. 等 2 分钟，访问 https://duckliu2024.github.io/stellar-park/"
echo ""
echo "  （vercel.app 在国内常需 VPN，可忽略）"
echo ""
