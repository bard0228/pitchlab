/**
 * 台灣好聲音（PitchLab）Google Drive 自動同步橋接腳本
 * 部署步驟：
 * 1. 前往 https://script.google.com/ 新增專案，貼上本檔案全部內容。
 * 2. 點右上角「部署」→「新增部署」→ 類型選「網頁應用程式」。
 *    - 執行身分：我
 *    - 誰可以存取：所有人（僅知道此專屬網址者可讀取 PitchLab_Songs 資料夾）
 * 3. 複製部署後的網頁應用程式網址（結尾為 /exec），貼回台灣好聲音 App 的「歌庫 → 雲端同步網址」。
 */

var PARENT_FOLDER_ID = '1dO5Gvb1naqbodVf0-_n0GEm62Akk-12P'; // 麻糬紅豆湯
var TARGET_FOLDER_NAME = 'PitchLab_Songs';

function getPitchLabFolder_() {
  var parent = DriveApp.getFolderById(PARENT_FOLDER_ID);
  var folders = parent.getFoldersByName(TARGET_FOLDER_NAME);
  if (folders.hasNext()) {
    return folders.next();
  }
  return parent.createFolder(TARGET_FOLDER_NAME);
}

function jsonOut_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  try {
    var action = (e && e.parameter && e.parameter.action) ? String(e.parameter.action) : 'list';
    var folder = getPitchLabFolder_();

    if (action === 'list') {
      var iter = folder.getFiles();
      var list = [];
      while (iter.hasNext()) {
        var f = iter.next();
        var name = f.getName();
        if (name.toLowerCase().slice(-4) !== '.zip') continue;
        list.push({
          id: f.getId(),
          name: name,
          size: f.getSize(),
          updatedAt: f.getLastUpdated().toISOString()
        });
      }
      return jsonOut_({ ok: true, folder: TARGET_FOLDER_NAME, files: list });
    }

    if (action === 'download') {
      var id = e && e.parameter && e.parameter.id ? String(e.parameter.id) : '';
      if (!id) return jsonOut_({ ok: false, error: '缺少檔案 ID' });

      var file = DriveApp.getFileById(id);
      var parents = file.getParents();
      var belongs = false;
      while (parents.hasNext()) {
        if (parents.next().getId() === folder.getId()) {
          belongs = true;
          break;
        }
      }
      if (!belongs) {
        return jsonOut_({ ok: false, error: '檔案不在 PitchLab_Songs 資料夾內' });
      }

      var b64 = Utilities.base64Encode(file.getBlob().getBytes());
      return jsonOut_({
        ok: true,
        id: file.getId(),
        name: file.getName(),
        base64: b64
      });
    }

    return jsonOut_({ ok: false, error: '未知的 action' });
  } catch (err) {
    return jsonOut_({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}
