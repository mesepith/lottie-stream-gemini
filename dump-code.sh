#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="/private/var/www/html/dev-app/live-stream-talk"
cd "$PROJECT_ROOT"

TS="$(date +"%Y%m%d-%H%M%S")"
OUT_TXT="${PROJECT_ROOT}/code_dump_${TS}.txt"
OUT_HTML="${PROJECT_ROOT}/code_dump_${TS}.html"

HDR="\033[1;96m"   # bold bright cyan for terminal headers
RST="\033[0m"

echo "Writing code dump to:"
echo "  - $OUT_TXT"
echo "  - $OUT_HTML"

# Prepare HTML (for colored headers in VS Code / browser)
cat > "$OUT_HTML" <<EOF
<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>Code dump ${TS}</title>
<style>
  :root { color-scheme: dark; }
  body { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
         background:#0b1020; color:#e6e6e6; margin:24px; }
  h1 { font-size: 20px; color:#e5e7eb; }
  h2 { color:#7dd3fc; background:#0f172a; padding:8px 12px; border-radius:12px;
       border:1px solid #1f2937; font-weight:700; margin:20px 0 8px; }
  pre { background:#0f172a; padding:12px; border-radius:12px; overflow:auto;
        border:1px solid #1f2937; }
  a { color:#93c5fd; text-decoration:none; }
</style>
</head><body>
<h1>Code dump ${TS} — ${PROJECT_ROOT}</h1>
EOF

# Find allowed files (exclude sensitive/ignored, previous dumps, and this script)
find . \
  -type d \( -name node_modules -o -name .git -o -path "./client/public" -o -path "./client/src/assets" -o -path "./server/api-keys" \) -prune -o \
  -type f \( \
      -name "package-lock.json" -o \
      -name ".env" -o \
      -name ".DS_Store" -o \
      -name "DS_Store" -o \
      -name "code_dump_*.txt" -o \
      -name "code_dump_*.html" -o \
      -path "*/api-keys/google-stt-tts.json" -o \
      -path "*/api-keys/.DS_Store" -o \
      -path "./dump-code.sh" -o \
      -name "*.command" -o \
      -name "live_preview_stream.py" -o \
      -path "./.gitignore" -o \
      -path "./client/.gitignore" -o \
      -path "./client/.env.production" -o \
      -path "./client/README.md" -o \
      -path "./client/eslint.config.js" -o \
      -path "./client/index.html" -o \
      -path "./client/package.json" -o \
      -path "./client/vite.config.js" -o \
      -path "./client/src/index.css" -o \
      -path "./client/src/main.jsx" -o \
      -path "./client/src/assets/react.svg" -o \
      -path "./client/public/favicon.ico" -o \
      -path "./client/public/vite.svg" \
    \) -prune -o \
  -type f -print0 \
| while IFS= read -r -d '' f; do
    printf "\n${HDR}========== %s ==========${RST}\n" "$f"   # terminal colored header

    { printf "\n========== %s ==========\n" "$f"; cat "$f"; } >> "$OUT_TXT"

    fid="$(printf "%s" "$f" | sed 's#[^A-Za-z0-9._/-]#-#g')"
    {
      printf '\n<h2 id="%s">%s</h2>\n<pre><code>\n' "$fid" "$f"
      sed 's/&/\&amp;/g; s/</\&lt;/g; s/>/\&gt;/g' "$f"
      printf '\n</code></pre>\n'
    } >> "$OUT_HTML"
  done

printf "\n</body></html>\n" >> "$OUT_HTML"

echo "✅ Saved:"
echo "   • $OUT_TXT"
echo "   • $OUT_HTML"
echo "Tip: open the HTML for colored headers in VS Code or a browser."
