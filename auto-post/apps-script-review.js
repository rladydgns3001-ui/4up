/**
 * Google Apps Script - 후기 승인 시스템
 *
 * 이 코드를 Google Apps Script 에디터에 복사하세요.
 * (script.google.com → 새 프로젝트 → 코드 붙여넣기 → 배포)
 *
 * 스프레드시트 구조 (첫 행 헤더):
 * A: timestamp | B: name | C: plan | D: period | E: rating | F: content | G: keyword | H: email | I: status
 *
 * 스크립트 속성 설정 (프로젝트 설정 → 스크립트 속성):
 * - TELEGRAM_BOT_TOKEN: 텔레그램 봇 토큰
 * - TELEGRAM_CHAT_ID: 알림 받을 채팅 ID
 * - SPREADSHEET_ID: 후기 저장할 스프레드시트 ID
 * - SHEET_NAME: 시트 이름 (기본값: "reviews")
 */

// ─── 설정 ───
function getConfig() {
  var props = PropertiesService.getScriptProperties();
  return {
    BOT_TOKEN: props.getProperty('TELEGRAM_BOT_TOKEN'),
    CHAT_ID: props.getProperty('TELEGRAM_CHAT_ID'),
    SPREADSHEET_ID: props.getProperty('SPREADSHEET_ID'),
    SHEET_NAME: props.getProperty('SHEET_NAME') || 'reviews'
  };
}

function getSheet() {
  var config = getConfig();
  var ss = SpreadsheetApp.openById(config.SPREADSHEET_ID);
  var sheet = ss.getSheetByName(config.SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(config.SHEET_NAME);
    sheet.appendRow(['timestamp', 'name', 'plan', 'period', 'rating', 'content', 'keyword', 'email', 'status']);
  }
  return sheet;
}

// ─── doGet: 승인된 후기 반환 ───
function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) || '';

  if (action === 'getReviews') {
    var sheet = getSheet();
    var data = sheet.getDataRange().getValues();
    var reviews = [];

    // 헤더 건너뛰고 (row 0), 데이터 읽기
    for (var i = 1; i < data.length; i++) {
      var status = (data[i][8] || '').toString().trim();
      if (status !== 'approved') continue;

      reviews.push({
        date: formatDate(data[i][0]),
        name: data[i][1] || '',
        plan: data[i][2] || '',
        period: data[i][3] || '',
        rating: data[i][4] || 5,
        content: data[i][5] || ''
      });
    }

    // 최신순 정렬
    reviews.reverse();

    var output = JSON.stringify({ reviews: reviews });
    return ContentService.createTextOutput(output)
      .setMimeType(ContentService.MimeType.JSON);
  }

  // 기본 응답
  return ContentService.createTextOutput(JSON.stringify({ status: 'ok' }))
    .setMimeType(ContentService.MimeType.JSON);
}

// ─── doPost: 폼 제출 + Telegram 콜백 처리 ───
function doPost(e) {
  var body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return jsonResponse({ error: 'Invalid JSON' });
  }

  // Telegram webhook callback_query
  if (body.callback_query) {
    return handleTelegramCallback(body.callback_query);
  }

  // 후기 폼 제출
  if (body.type === 'review') {
    return handleReviewSubmission(body);
  }

  return jsonResponse({ status: 'ignored' });
}

// ─── 후기 제출 처리 ───
function handleReviewSubmission(data) {
  var sheet = getSheet();
  var timestamp = new Date();

  var row = [
    timestamp,
    data.name || '',
    data.plan || '',
    data.period || '',
    data.rating || 5,
    data.content || '',
    data.keyword || '',
    data.email || '',
    'pending'
  ];
  sheet.appendRow(row);

  // 방금 추가한 행 번호
  var rowNum = sheet.getLastRow();

  // 텔레그램 알림 전송
  sendTelegramNotification(data, rowNum);

  return jsonResponse({ status: 'submitted' });
}

// ─── 텔레그램 알림 전송 ───
function sendTelegramNotification(data, rowNum) {
  var config = getConfig();
  var stars = '';
  for (var i = 0; i < 5; i++) {
    stars += i < (data.rating || 5) ? '★' : '☆';
  }

  var message = [
    '📝 *새 후기가 접수되었습니다*',
    '─'.repeat(20),
    '👤 이름: ' + (data.name || '익명'),
    '⭐ 별점: ' + stars + ' (' + (data.rating || 5) + '/5)',
    '📦 플랜: ' + (data.plan || '-'),
    '⏱ 사용기간: ' + (data.period || '-'),
    '─'.repeat(20),
    (data.content || '').substring(0, 500),
    '─'.repeat(20),
    '',
    '승인 또는 거절을 선택해주세요.'
  ].join('\n');

  var payload = {
    chat_id: config.CHAT_ID,
    text: message,
    parse_mode: 'Markdown',
    reply_markup: JSON.stringify({
      inline_keyboard: [
        [
          { text: '✅ 승인', callback_data: 'review_approve_' + rowNum },
          { text: '❌ 거절', callback_data: 'review_reject_' + rowNum }
        ]
      ]
    })
  };

  UrlFetchApp.fetch('https://api.telegram.org/bot' + config.BOT_TOKEN + '/sendMessage', {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
}

// ─── 텔레그램 콜백 처리 ───
function handleTelegramCallback(callbackQuery) {
  var config = getConfig();
  var data = callbackQuery.data || '';
  var callbackId = callbackQuery.id;

  // callback_data 파싱: review_approve_<row> 또는 review_reject_<row>
  var match = data.match(/^review_(approve|reject)_(\d+)$/);
  if (!match) {
    answerCallback(config.BOT_TOKEN, callbackId, '알 수 없는 동작입니다.');
    return jsonResponse({ status: 'unknown_callback' });
  }

  var action = match[1]; // approve 또는 reject
  var rowNum = parseInt(match[2], 10);
  var newStatus = action === 'approve' ? 'approved' : 'rejected';

  // 시트 상태 업데이트 (I열 = 9번째 컬럼)
  var sheet = getSheet();
  var currentStatus = sheet.getRange(rowNum, 9).getValue();

  if (currentStatus !== 'pending') {
    answerCallback(config.BOT_TOKEN, callbackId, '이미 처리된 후기입니다.');
    return jsonResponse({ status: 'already_processed' });
  }

  sheet.getRange(rowNum, 9).setValue(newStatus);

  // 후기 정보 가져오기
  var name = sheet.getRange(rowNum, 2).getValue() || '익명';

  // 텔레그램 메시지 편집 (버튼 제거 + 결과 표시)
  var chatId = callbackQuery.message.chat.id;
  var messageId = callbackQuery.message.message_id;
  var resultEmoji = action === 'approve' ? '✅' : '❌';
  var resultText = action === 'approve' ? '승인됨' : '거절됨';
  var originalText = callbackQuery.message.text || '';

  editTelegramMessage(config.BOT_TOKEN, chatId, messageId,
    originalText + '\n\n' + resultEmoji + ' *' + resultText + '* (처리 완료)');

  // 콜백 응답
  answerCallback(config.BOT_TOKEN, callbackId, resultText + ' 처리 완료!');

  return jsonResponse({ status: newStatus });
}

// ─── 텔레그램 API 헬퍼 ───
function answerCallback(token, callbackId, text) {
  UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/answerCallbackQuery', {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({
      callback_query_id: callbackId,
      text: text
    }),
    muteHttpExceptions: true
  });
}

function editTelegramMessage(token, chatId, messageId, newText) {
  UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/editMessageText', {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({
      chat_id: chatId,
      message_id: messageId,
      text: newText,
      parse_mode: 'Markdown'
    }),
    muteHttpExceptions: true
  });
}

// ─── 유틸리티 ───
function formatDate(date) {
  if (!date) return '';
  if (typeof date === 'string') return date;
  var d = new Date(date);
  var yyyy = d.getFullYear();
  var mm = ('0' + (d.getMonth() + 1)).slice(-2);
  var dd = ('0' + d.getDate()).slice(-2);
  return yyyy + '-' + mm + '-' + dd;
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
