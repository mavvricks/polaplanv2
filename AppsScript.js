/**
 * Google Apps Script - POLA Planner database
 *
 * Sheet setup:
 * - Create tabs named "Tasks" and "Subjects"
 * - Deploy as Web App
 * - Execute as: Me
 * - Who has access: Anyone
 * - Copy the deployment URL into APPS_SCRIPT_URL in script.js
 */

const TASK_HEADERS = [
  'id',
  'title',
  'type',
  'subject',
  'date',
  'startTime',
  'deadlineTime',
  'priority',
  'estimate',
  'desc',
  'completed'
];

const SUBJECT_HEADERS = ['id', 'name', 'color'];
const SPREADSHEET_ID = '';

function doGet(e) {
  try {
    ensureDatabase();

    const action = (e && e.parameter && e.parameter.action) || 'getAll';
    const data = {};

    if (action === 'getAll' || action === 'getTasks') {
      data.tasks = getSheetData_('Tasks');
    }

    if (action === 'getAll' || action === 'getSubjects') {
      data.subjects = getSheetData_('Subjects');
    }

    return json_({ success: true, data });
  } catch (err) {
    return json_({ success: false, error: String(err && err.message ? err.message : err) });
  }
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);

  try {
    ensureDatabase();

    const payload = JSON.parse((e.postData && e.postData.contents) || '{}');
    const action = payload.action;
    const data = {};

    switch (action) {
      case 'syncAll':
        writeAll_('Tasks', TASK_HEADERS, payload.tasks || []);
        writeAll_('Subjects', SUBJECT_HEADERS, payload.subjects || []);
        data.message = 'Full sync complete';
        break;

      case 'addTask':
        upsertRow_('Tasks', TASK_HEADERS, 'id', payload.task);
        data.message = 'Task saved';
        break;

      case 'updateTask':
        upsertRow_('Tasks', TASK_HEADERS, 'id', payload.task);
        data.message = 'Task updated';
        break;

      case 'deleteTask':
        deleteRow_('Tasks', 'id', payload.taskId);
        data.message = 'Task deleted';
        break;

      case 'addSubject':
        upsertRow_('Subjects', SUBJECT_HEADERS, 'id', payload.subject);
        data.message = 'Subject saved';
        break;

      case 'updateSubject':
        upsertRow_('Subjects', SUBJECT_HEADERS, 'id', payload.subject);
        data.message = 'Subject updated';
        break;

      case 'deleteSubject':
        deleteRow_('Subjects', 'id', payload.subjectId);
        data.message = 'Subject deleted';
        break;

      default:
        throw new Error('Unknown action: ' + action);
    }

    return json_({ success: true, data });
  } catch (err) {
    return json_({ success: false, error: String(err && err.message ? err.message : err) });
  } finally {
    lock.releaseLock();
  }
}

function ensureDatabase() {
  ensureSheet_('Tasks', TASK_HEADERS);
  ensureSheet_('Subjects', SUBJECT_HEADERS);
}

function ensureSheet_(name, headers) {
  const spreadsheet = getSpreadsheet_();
  let sheet = spreadsheet.getSheetByName(name);

  if (!sheet) {
    sheet = spreadsheet.insertSheet(name);
  }

  const currentWidth = Math.max(sheet.getLastColumn(), headers.length);
  const currentHeaders = sheet.getRange(1, 1, 1, currentWidth).getValues()[0];
  const mergedHeaders = headers.slice();

  currentHeaders.forEach((header) => {
    if (header && mergedHeaders.indexOf(header) === -1) {
      mergedHeaders.push(header);
    }
  });

  sheet.getRange(1, 1, 1, mergedHeaders.length).setValues([mergedHeaders]);
  sheet.setFrozenRows(1);
  return sheet;
}

function getSheetData_(sheetName) {
  const sheet = getSpreadsheet_().getSheetByName(sheetName);
  if (!sheet || sheet.getLastRow() <= 1) return [];

  const values = sheet.getRange(1, 1, sheet.getLastRow(), sheet.getLastColumn()).getValues();
  const headers = values[0].filter(Boolean);
  const rows = values.slice(1);

  return rows
    .filter((row) => row.some((cell) => cell !== '' && cell !== null))
    .map((row) => {
      const item = {};
      headers.forEach((header, index) => {
        item[header] = normalizeValue_(row[index]);
      });
      return item;
    });
}

function writeAll_(sheetName, headers, items) {
  const sheet = ensureSheet_(sheetName, headers);
  const lastRow = sheet.getLastRow();

  if (lastRow > 1) {
    sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).clearContent();
  }

  if (!items || items.length === 0) return;

  const rows = items.map((item) => headers.map((header) => serializeValue_(item && item[header])));
  sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
}

function upsertRow_(sheetName, defaultHeaders, keyHeader, item) {
  if (!item || !item[keyHeader]) {
    throw new Error('Missing ' + keyHeader + ' for ' + sheetName);
  }

  const sheet = ensureSheet_(sheetName, defaultHeaders);
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].filter(Boolean);
  const keyIndex = headers.indexOf(keyHeader);

  if (keyIndex === -1) {
    throw new Error('Missing key column: ' + keyHeader);
  }

  const row = headers.map((header) => serializeValue_(item[header]));
  const lastRow = sheet.getLastRow();

  if (lastRow > 1) {
    const keys = sheet.getRange(2, keyIndex + 1, lastRow - 1, 1).getValues();
    for (let i = 0; i < keys.length; i += 1) {
      if (String(keys[i][0]) === String(item[keyHeader])) {
        sheet.getRange(i + 2, 1, 1, headers.length).setValues([row]);
        return;
      }
    }
  }

  sheet.appendRow(row);
}

function deleteRow_(sheetName, keyHeader, keyValue) {
  const sheet = getSpreadsheet_().getSheetByName(sheetName);
  if (!sheet || !keyValue) return;

  const values = sheet.getDataRange().getValues();
  if (values.length <= 1) return;

  const headers = values[0];
  const keyIndex = headers.indexOf(keyHeader);
  if (keyIndex === -1) return;

  for (let i = values.length - 1; i >= 1; i -= 1) {
    if (String(values[i][keyIndex]) === String(keyValue)) {
      sheet.deleteRow(i + 1);
      return;
    }
  }
}

function normalizeValue_(value) {
  if (value instanceof Date) {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }

  if (value === true || value === 'TRUE' || value === 'true') return true;
  if (value === false || value === 'FALSE' || value === 'false') return false;
  if (value === null || value === undefined) return '';

  return value;
}

function serializeValue_(value) {
  if (value === null || value === undefined) return '';
  return value;
}

function getSpreadsheet_() {
  const spreadsheet = SPREADSHEET_ID
    ? SpreadsheetApp.openById(SPREADSHEET_ID)
    : SpreadsheetApp.getActiveSpreadsheet();

  if (!spreadsheet) {
    throw new Error('No spreadsheet found. Bind this script to the Google Sheet or set SPREADSHEET_ID.');
  }

  return spreadsheet;
}

function json_(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}
