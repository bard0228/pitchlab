# 台灣好聲音（PitchLab PWA）

AI 分軌、漸進導唱混音、升降調（變調不變速）與即時麥克風音準追蹤練習 PWA。

## 線上使用（Google Pixel 10 Pro Chrome）
- 網址：`https://bard0228.github.io/pitchlab/`
- 建議使用 **Chrome** 開啟或安裝為主畫面 PWA，以完整啟用麥克風即時收音功能。

## 本機／Colab 歌曲分軌打包

### 1. Google Colab（手機即可處理）
開啟 [pipeline/PitchLab_Colab.ipynb](pipeline/PitchLab_Colab.ipynb)，上傳音檔或貼上 YouTube 網址，自動使用 Demucs AI 分離伴奏與原人聲並萃取 `pitch.json`，輸出可直接匯入「離線歌庫」的 `.zip` 歌包。

### 2. 本機 Python CLI
```bash
pip install -r pipeline/requirements.txt
# 需預先安裝 ffmpeg
python3 pipeline/process_song.py --input your_song.mp3 --title "歌名" --out song.zip
```
若使用選用 YouTube 網址：
```bash
python3 pipeline/process_song.py --youtube "https://www.youtube.com/watch?v=..." --title "歌名" --out song.zip
```
> 若遇到 YouTube 風控驗證或存取限制，管線會立即停止並提示改用本機 MP3 / WAV / M4A 音檔。

## 驗證測試
```bash
python3 -m unittest -v tests/test_pipeline.py
node --test tests/audio-math.test.mjs tests/pitch-judge.test.mjs tests/zip-reader.test.mjs
node tests/verify-tb01.mjs
node tests/verify-tb03.mjs
node tests/verify-tb04.mjs
```
