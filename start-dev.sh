#!/usr/bin/env bash
# Start LearnForge dev server (Linux/macOS/Git Bash)
cd "$(dirname "$0")"
echo "============================================"
echo " Starting LearnForge dev server..."
echo " Open: http://localhost:3100"
echo " Press Ctrl+C to stop"
echo "============================================"
# -H 127.0.0.1: loopback only (blocks spoofed Host: localhost token theft)
# -p 3100:      NC-API port table (LearnForge = 3100); 3000 is the main site.
npm run dev -- -p 3100 -H 127.0.0.1
