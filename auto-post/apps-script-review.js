/**
 * Google Apps Script - 후기 승인 시스템
 *
 * Script Properties에 다음 값을 설정하세요:
 *   TELEGRAM_BOT_TOKEN  - 텔레그램 봇 토큰
 *   TELEGRAM_CHAT_ID    - 텔레그램 채팅 ID
 *   SPREADSHEET_ID      - 후기 스프레드시트 ID
 *   WP_URL              - https://wpauto.kr
 *   WP_USER             - WordPress 사용자 이메일
 *   WP_APP_PASSWORD     - WordPress 앱 비밀번호
 */

var PROPS = PropertiesService.getScriptProperties();
var BOT_TOKEN = PROPS.getProperty('TELEGRAM_BOT_TOKEN');
var CHAT_ID = PROPS.getProperty('TELEGRAM_CHAT_ID');
var SHEET_ID = PROPS.getProperty('SPREADSHEET_ID');

// ─── doGet: 승인된 후기 JSON 반환 ───
function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) || '';
  if (action === 'getReviews') {
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var sheet = ss.getSheetByName('reviews') || ss.getSheets()[0];
    var data = sheet.getDataRange().getValues();
    var reviews = [];
    for (var i = 1; i < data.length; i++) {
      if (data[i][8] === 'approved') {
        reviews.push({
          date: Utilities.formatDate(new Date(data[i][0]), 'Asia/Seoul', 'yyyy-MM-dd'),
          name: data[i][1],
          plan: data[i][2],
          period: data[i][3],
          rating: data[i][4],
          content: data[i][5],
          keyword: data[i][6],
          email: data[i][7]
        });
      }
    }
    return ContentService.createTextOutput(JSON.stringify({ reviews: reviews }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  return ContentService.createTextOutput('OK');
}

// ─── doPost: 후기 폼 제출 처리 ───
function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    if (body.type !== 'review') return ContentService.createTextOutput('ignored');

    var ss = SpreadsheetApp.openById(SHEET_ID);
    var sheet = ss.getSheetByName('reviews') || ss.getSheets()[0];
    var row = sheet.getLastRow() + 1;

    // 예약 후기(needsApproval)는 pending → 텔레그램 승인 필요
    // 홈페이지 직접 작성은 바로 approved → 자동 발행
    var needsApproval = body.needsApproval === true;
    var status = needsApproval ? 'pending' : 'approved';

    sheet.getRange(row, 1, 1, 9).setValues([[
      new Date(),
      body.name || '',
      body.plan || '',
      body.period || '',
      body.rating || 5,
      body.content || '',
      body.keyword || '',
      body.email || '',
      status
    ]]);

    if (needsApproval) {
      // 예약 후기: 텔레그램 승인/거절 버튼
      sendTelegramNotification(body, row);
    } else {
      // 홈페이지 직접 작성: 바로 발행 + 텔레그램 알림만
      try {
        publishToWordPress(row);
      } catch (err) {
        UrlFetchApp.fetch('https://api.telegram.org/bot' + BOT_TOKEN + '/sendMessage', {
          method: 'post',
          contentType: 'application/json',
          payload: JSON.stringify({ chat_id: CHAT_ID, text: '\u26A0\uFE0F WP \uBC30\uD3EC \uC2E4\uD328: ' + err.message })
        });
      }
      // 텔레그램에 알림 (버튼 없이)
      var stars = '';
      for (var i = 0; i < (body.rating || 5); i++) stars += '\u2B50';
      UrlFetchApp.fetch('https://api.telegram.org/bot' + BOT_TOKEN + '/sendMessage', {
        method: 'post',
        contentType: 'application/json',
        payload: JSON.stringify({
          chat_id: CHAT_ID,
          text: '\uD83D\uDCDD \uC0C8 \uD6C4\uAE30 \uC790\uB3D9 \uBC1C\uD589!\n\n'
            + '\uC774\uB984: ' + (body.name || '') + '\n'
            + '\uD50C\uB79C: ' + (body.plan || '') + '\n'
            + '\uBCC4\uC810: ' + stars + '\n'
            + '\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n'
            + (body.content || '').substring(0, 100) + '...'
        })
      });
    }

    return ContentService.createTextOutput('ok');
  } catch (err) {
    return ContentService.createTextOutput('error: ' + err.message);
  }
}

// ─── 텔레그램 알림 전송 ───
function sendTelegramNotification(body, row) {
  var stars = '';
  for (var i = 0; i < (body.rating || 5); i++) stars += '\u2B50';

  var text = '\uD83D\uDCDD \uC0C8 \uD6C4\uAE30 \uC811\uC218!\n\n'
    + '\uC774\uB984: ' + (body.name || '') + '\n'
    + '\uD50C\uB79C: ' + (body.plan || '') + '\n'
    + '\uAE30\uAC04: ' + (body.period || '') + '\n'
    + '\uBCC4\uC810: ' + stars + '\n'
    + '\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n'
    + (body.content || '') + '\n'
    + '\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n'
    + '\uD0A4\uC6CC\uB4DC: ' + (body.keyword || '') + '\n'
    + '\uC774\uBA54\uC77C: ' + (body.email || '');

  var payload = {
    chat_id: CHAT_ID,
    text: text,
    reply_markup: JSON.stringify({
      inline_keyboard: [[
        { text: '\u2705 \uC2B9\uC778', callback_data: 'approve_' + row },
        { text: '\u274C \uAC70\uC808', callback_data: 'reject_' + row }
      ]]
    })
  };

  UrlFetchApp.fetch('https://api.telegram.org/bot' + BOT_TOKEN + '/sendMessage', {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload)
  });
}

// ─── 텔레그램 폴링 (1분 트리거) ───
function checkTelegramUpdates() {
  var url = 'https://api.telegram.org/bot' + BOT_TOKEN + '/getUpdates?timeout=0&allowed_updates=' + encodeURIComponent('["callback_query"]');
  var res = UrlFetchApp.fetch(url);
  var data = JSON.parse(res.getContentText());

  if (!data.result || data.result.length === 0) return;

  for (var i = 0; i < data.result.length; i++) {
    var update = data.result[i];
    if (update.callback_query) {
      handleTelegramCallback(update.callback_query);
    }
  }

  var lastId = data.result[data.result.length - 1].update_id;
  UrlFetchApp.fetch('https://api.telegram.org/bot' + BOT_TOKEN + '/getUpdates?offset=' + (lastId + 1) + '&timeout=0');
}

// ─── 콜백 처리 (승인/거절) ───
function handleTelegramCallback(cq) {
  var parts = cq.data.split('_');
  var action = parts[0];
  var row = parseInt(parts[1]);

  // 1. 스프레드시트 상태 업데이트
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sheet = ss.getSheetByName('reviews') || ss.getSheets()[0];
  var status = (action === 'approve') ? 'approved' : 'rejected';
  sheet.getRange(row, 9).setValue(status);

  // 2. 텔레그램 콜백 응답
  UrlFetchApp.fetch('https://api.telegram.org/bot' + BOT_TOKEN + '/answerCallbackQuery', {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ callback_query_id: cq.id, text: (action === 'approve') ? '\uC2B9\uC778 \uC644\uB8CC!' : '\uAC70\uC808 \uC644\uB8CC!' })
  });

  // 3. 텔레그램 메시지 편집
  var emoji = (action === 'approve') ? '\u2705' : '\u274C';
  var label = (action === 'approve') ? '\uC2B9\uC778\uB428' : '\uAC70\uC808\uB428';
  UrlFetchApp.fetch('https://api.telegram.org/bot' + BOT_TOKEN + '/editMessageText', {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({
      chat_id: cq.message.chat.id,
      message_id: cq.message.message_id,
      text: emoji + ' ' + label + ' (\uCC98\uB9AC \uC644\uB8CC)'
    })
  });

  // 4. 승인이면 WordPress에 자동 배포
  if (action === 'approve') {
    try {
      publishToWordPress(row);
    } catch (err) {
      // 배포 실패 시 텔레그램으로 알림
      UrlFetchApp.fetch('https://api.telegram.org/bot' + BOT_TOKEN + '/sendMessage', {
        method: 'post',
        contentType: 'application/json',
        payload: JSON.stringify({
          chat_id: CHAT_ID,
          text: '\u26A0\uFE0F WP \uBC30\uD3EC \uC2E4\uD328: ' + err.message
        })
      });
    }
  }
}

// ─── WordPress 자동 배포 ───
function publishToWordPress(approvedRow) {
  var wpUrl = PROPS.getProperty('WP_URL');
  var wpUser = PROPS.getProperty('WP_USER');
  var wpPass = PROPS.getProperty('WP_APP_PASSWORD');
  if (!wpUrl || !wpUser || !wpPass) return;

  // 1. 승인된 후기 데이터 가져오기
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sheet = ss.getSheetByName('reviews') || ss.getSheets()[0];
  var rowData = sheet.getRange(approvedRow, 1, 1, 9).getValues()[0];

  var review = {
    date: Utilities.formatDate(new Date(rowData[0]), 'Asia/Seoul', 'yyyy-MM-dd'),
    name: String(rowData[1]),
    plan: String(rowData[2]),
    period: String(rowData[3]),
    rating: Number(rowData[4]),
    content: String(rowData[5])
  };

  // 2. 현재 WordPress 페이지 raw content 가져오기
  var auth = Utilities.base64Encode(wpUser + ':' + wpPass);
  var pageRes = UrlFetchApp.fetch(wpUrl + '/wp-json/wp/v2/pages/209?context=edit', {
    headers: { 'Authorization': 'Basic ' + auth }
  });
  var pageData = JSON.parse(pageRes.getContentText());
  var rawContent = pageData.content.raw || '';

  // wp:html 래퍼 제거
  var html = rawContent.replace(/<!--\s*wp:html\s*-->\n?/, '').replace(/\n?<!--\s*\/wp:html\s*-->/, '');

  // 3. 현재 후기 수 파악
  var countMatch = html.match(/HARDCODED_REVIEW_COUNT\s*=\s*(\d+)/);
  var currentCount = countMatch ? parseInt(countMatch[1]) : 13;
  var newNum = currentCount + 1;

  // 4. 새 후기 HTML 생성
  var masked = review.name.length > 2 ? review.name.substring(0, 2) + '**' : review.name.length > 1 ? review.name.charAt(0) + '*' : review.name;
  var isPro = review.plan.indexOf('Pro') >= 0;
  var badgeClass = isPro ? 'rv-badge-pro' : 'rv-badge-paid';
  var badgeText = isPro ? 'Pro' : 'Basic';
  var ratingNum = review.rating.toFixed(1);
  var starsHtml = '';
  for (var s = 0; s < 5; s++) starsHtml += (s < review.rating) ? '\u2605' : '\u2606';
  var dateStr = review.date.substring(5, 10).replace('-', '.');
  var titleText = review.content.length > 35 ? htmlEscape(review.content.substring(0, 35)) + '...' : htmlEscape(review.content);

  var tags = '';
  if (review.plan) tags += '<span class="rv-detail-tag">' + htmlEscape(review.plan) + '</span>';
  if (review.period) tags += '<span class="rv-detail-tag">' + htmlEscape(review.period) + '</span>';

  var newReviewHtml = '<div class="rv-board-row" data-cat="paid">'
    + '<div class="rv-col-no">' + newNum + '</div>'
    + '<div class="rv-col-title"><span class="rv-badge ' + badgeClass + '">' + badgeText + '</span>' + titleText + '</div>'
    + '<div class="rv-col-author">' + htmlEscape(masked) + '</div>'
    + '<div class="rv-col-date">' + dateStr + '</div>'
    + '<div class="rv-col-rating">\u2605 ' + ratingNum + '</div>'
    + '</div>'
    + '<div class="rv-board-detail">'
    + '<div class="rv-detail-inner">'
    + '<div class="rv-detail-stars">' + starsHtml + '</div>'
    + '<div class="rv-detail-meta">' + htmlEscape(masked) + ' \u00B7 ' + htmlEscape(review.plan) + ' \u00B7 \uC0AC\uC6A9 ' + htmlEscape(review.period) + '</div>'
    + '<div class="rv-detail-body">' + htmlEscape(review.content) + '</div>'
    + (tags ? '<div class="rv-detail-tags">' + tags + '</div>' : '')
    + '</div></div>\n';

  // 5. 첫 번째 후기 앞에 삽입 (항상 최상단)
  var firstRow = html.indexOf('<div class="rv-board-row"');
  if (firstRow >= 0) {
    html = html.substring(0, firstRow) + newReviewHtml + html.substring(firstRow);
  }

  // 7. 카운트 업데이트
  html = html.replace(/HARDCODED_REVIEW_COUNT\s*=\s*\d+/, 'HARDCODED_REVIEW_COUNT = ' + newNum);
  html = html.replace(/(id="rv-total-count">)\d+\+/, '$1' + newNum + '+');
  html = html.replace(/(id="rv-tab-all-count">\()\d+\)/, '$1' + newNum + ')');
  html = html.replace(/(id="rv-tab-paid-count">\()\d+\)/, '$1' + newNum + ')');

  // 8. WordPress에 업데이트
  var wpContent = '<!-- wp:html -->\n' + html + '\n<!-- /wp:html -->';
  UrlFetchApp.fetch(wpUrl + '/wp-json/wp/v2/pages/209', {
    method: 'put',
    contentType: 'application/json',
    headers: { 'Authorization': 'Basic ' + auth },
    payload: JSON.stringify({ content: wpContent })
  });

  // 9. 메인 페이지(17) + 상품 페이지(431) 후기 수 업데이트
  updatePageReviewCount(wpUrl, auth, 17, newNum);
  updatePageReviewCount(wpUrl, auth, 431, newNum);

  // 10. 성공 알림
  UrlFetchApp.fetch('https://api.telegram.org/bot' + BOT_TOKEN + '/sendMessage', {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({
      chat_id: CHAT_ID,
      text: '\u2705 \uD6C4\uAE30 #' + newNum + ' WordPress \uBC1C\uD589 \uC644\uB8CC!\nhttps://wpauto.kr/reviews/'
    })
  });
}

// ─── 페이지 후기 수 업데이트 ───
function updatePageReviewCount(wpUrl, auth, pageId, newCount) {
  try {
    var res = UrlFetchApp.fetch(wpUrl + '/wp-json/wp/v2/pages/' + pageId + '?context=edit', {
      headers: { 'Authorization': 'Basic ' + auth }
    });
    var page = JSON.parse(res.getContentText());
    var raw = page.content.raw;
    if (!raw) return;

    var updated = raw.replace(/\d+\+\s*리뷰/g, newCount + '+ \uB9AC\uBDF0');
    updated = updated.replace(/\uB9AC\uBDF0\s*\d+\+/g, '\uB9AC\uBDF0 ' + newCount + '+');
    updated = updated.replace(/"reviewCount":\s*"\d+"/g, '"reviewCount": "' + newCount + '"');

    if (updated !== raw) {
      UrlFetchApp.fetch(wpUrl + '/wp-json/wp/v2/pages/' + pageId, {
        method: 'put',
        contentType: 'application/json',
        headers: { 'Authorization': 'Basic ' + auth },
        payload: JSON.stringify({ content: updated })
      });
    }
  } catch (e) {
    // 실패해도 메인 배포에 영향 없도록 무시
  }
}

// ─── HTML 이스케이프 ───
function htmlEscape(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─── 트리거 설정 (1회 실행) ───
function setupPollingTrigger() {
  // 기존 트리거 제거
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'checkTelegramUpdates') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  // 1분마다 실행
  ScriptApp.newTrigger('checkTelegramUpdates')
    .timeBased()
    .everyMinutes(1)
    .create();
}
