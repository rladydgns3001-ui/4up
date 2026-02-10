const TelegramBot = require("node-telegram-bot-api");
const fs = require("fs");

const APPROVAL_TIMEOUT = 2 * 60 * 60 * 1000; // 2시간

class TelegramApproval {
  constructor(botToken, chatId) {
    this.chatId = chatId;
    this.bot = new TelegramBot(botToken, { polling: true });
    this._callbackResolve = null;
    this._textResolve = null;
    this._messageId = null;

    // 콜백 쿼리 (인라인 버튼 클릭) 핸들러
    this.bot.on("callback_query", (query) => {
      if (this._callbackResolve) {
        this.bot.answerCallbackQuery(query.id);
        this._callbackResolve(query.data);
        this._callbackResolve = null;
      }
    });

    // 텍스트 메시지 핸들러 (수정 모드용)
    this.bot.on("message", (msg) => {
      if (
        this._textResolve &&
        msg.chat.id.toString() === this.chatId.toString() &&
        msg.text &&
        !msg.text.startsWith("/")
      ) {
        this._textResolve(msg.text);
        this._textResolve = null;
      }
    });
  }

  /**
   * 글 미리보기 + 인라인 버튼 전송
   * @param {object} post - 포스트 데이터
   * @param {object} [mediaInfo] - 미디어 정보 { fileName, filePath, isVideo }
   */
  async sendApprovalMessage(post, mediaInfo) {
    // previewText가 있으면 사용 (숨김 효과 표시), 없으면 일반 text
    const displayText = post.previewText || post.text;
    const charCount = (post.threadsText || post.text).length;
    let warning = "";
    if (charCount < 100) warning = "\n⚠️ 글이 너무 짧습니다 (100자 미만)";
    else if (charCount > 500) warning = "\n⚠️ 글이 너무 깁니다 (500자 초과)";

    const hasSpoiler = post.previewText && post.previewText.includes("【스포일러 적용】");

    // 미디어 정보 문자열
    let mediaLine = "📷 미디어: 없음";
    if (mediaInfo && mediaInfo.fileName) {
      const typeLabel = mediaInfo.isVideo ? "영상" : "이미지";
      mediaLine = `📷 미디어: ${mediaInfo.fileName} (${typeLabel})`;
    }

    // 미디어 파일 미리보기 전송
    if (mediaInfo && mediaInfo.filePath && fs.existsSync(mediaInfo.filePath)) {
      try {
        if (mediaInfo.isVideo) {
          await this.bot.sendVideo(this.chatId, mediaInfo.filePath, {
            caption: `🎬 첨부 영상: ${mediaInfo.fileName}`,
          });
        } else {
          await this.bot.sendPhoto(this.chatId, mediaInfo.filePath, {
            caption: `🖼 첨부 이미지: ${mediaInfo.fileName}`,
          });
        }
      } catch (e) {
        // 미디어 전송 실패 시 무시 (텍스트 메시지는 계속 전송)
      }
    }

    const message = [
      "📱 *Threads 글 미리보기*",
      hasSpoiler ? "⚡ 스포일러 구간 포함 (발행 후 15분 내 앱에서 적용)" : "",
      "─".repeat(20),
      displayText,
      "─".repeat(20),
      `🏷 토픽태그: #${post.topicTag}`,
      `📊 글자수: ${charCount}자${warning}`,
      mediaLine,
      "",
      "아래 버튼을 눌러주세요 (2시간 후 자동 취소)",
    ].filter(Boolean).join("\n");

    const keyboard = {
      reply_markup: {
        inline_keyboard: [
          [
            { text: "✅ 발행", callback_data: "approve" },
            { text: "🔄 재생성", callback_data: "regenerate" },
          ],
          [
            { text: "✏️ 수정", callback_data: "edit" },
            { text: "❌ 취소", callback_data: "cancel" },
          ],
          [
            { text: "📷 사진변경", callback_data: "change_media" },
            { text: "🚫 사진없이", callback_data: "no_media" },
          ],
        ],
      },
      parse_mode: "Markdown",
    };

    const sent = await this.bot.sendMessage(this.chatId, message, keyboard);
    this._messageId = sent.message_id;
    return sent;
  }

  /**
   * 버튼 클릭 대기 (Promise 기반, 타임아웃 포함)
   */
  waitForApproval(timeout = APPROVAL_TIMEOUT) {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this._callbackResolve = null;
        resolve("timeout");
      }, timeout);

      this._callbackResolve = (data) => {
        clearTimeout(timer);
        resolve(data);
      };
    });
  }

  /**
   * 수정 모드: 사용자 텍스트 메시지 대기
   */
  async waitForTextInput(timeout = APPROVAL_TIMEOUT) {
    await this.bot.sendMessage(
      this.chatId,
      "✏️ 수정할 본문을 입력해주세요:\n(텍스트 메시지로 보내주세요)"
    );

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this._textResolve = null;
        resolve(null);
      }, timeout);

      this._textResolve = (text) => {
        clearTimeout(timer);
        resolve(text);
      };
    });
  }

  /**
   * 사용 가능한 미디어 목록 표시 + 선택 버튼
   * @param {Array<{fileName: string, isVideo: boolean}>} mediaFiles
   */
  async sendMediaOptions(mediaFiles) {
    const lines = ["📷 사용 가능한 미디어:"];
    mediaFiles.forEach((f, i) => {
      const typeLabel = f.isVideo ? "영상" : "이미지";
      lines.push(`${i + 1}. ${f.fileName} (${typeLabel})`);
    });
    lines.push("", "번호를 선택하세요:");

    // 인라인 버튼 (최대 8개씩 한 행, Telegram 제한은 8)
    const buttons = mediaFiles.map((_, i) => ({
      text: `${i + 1}`,
      callback_data: `media_${i}`,
    }));
    // 5개씩 한 행으로 분할
    const rows = [];
    for (let i = 0; i < buttons.length; i += 5) {
      rows.push(buttons.slice(i, i + 5));
    }

    const sent = await this.bot.sendMessage(this.chatId, lines.join("\n"), {
      reply_markup: { inline_keyboard: rows },
    });
    this._messageId = sent.message_id;
    return sent;
  }

  /**
   * 미디어 선택 콜백 대기 (media_N 형식)
   * @returns {Promise<number|null>} 선택된 미디어 인덱스 또는 null (타임아웃)
   */
  waitForMediaChoice(timeout = APPROVAL_TIMEOUT) {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this._callbackResolve = null;
        resolve(null);
      }, timeout);

      this._callbackResolve = (data) => {
        clearTimeout(timer);
        if (data.startsWith("media_")) {
          resolve(parseInt(data.replace("media_", ""), 10));
        } else {
          resolve(null);
        }
      };
    });
  }

  /**
   * 결과 알림 전송
   */
  async sendResult(message) {
    await this.bot.sendMessage(this.chatId, message, {
      parse_mode: "Markdown",
    });
  }

  /**
   * 이전 미리보기 메시지의 버튼 제거
   */
  async removeButtons() {
    if (this._messageId) {
      try {
        await this.bot.editMessageReplyMarkup(
          { inline_keyboard: [] },
          { chat_id: this.chatId, message_id: this._messageId }
        );
      } catch (e) {
        // 이미 수정됐거나 삭제된 경우 무시
      }
    }
  }

  /**
   * 봇 폴링 종료
   */
  stop() {
    this.bot.stopPolling();
  }
}

module.exports = TelegramApproval;
