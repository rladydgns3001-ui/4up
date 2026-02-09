const TelegramBot = require("node-telegram-bot-api");

const APPROVAL_TIMEOUT = 10 * 60 * 1000; // 10분

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
   */
  async sendApprovalMessage(post) {
    const charCount = post.text.length;
    let warning = "";
    if (charCount < 100) warning = "\n⚠️ 글이 너무 짧습니다 (100자 미만)";
    else if (charCount > 500) warning = "\n⚠️ 글이 너무 깁니다 (500자 초과)";

    const message = [
      "📱 *Threads 글 미리보기*",
      "─".repeat(20),
      post.text,
      "─".repeat(20),
      `🏷 토픽태그: #${post.topicTag}`,
      `📊 글자수: ${charCount}자${warning}`,
      "",
      "아래 버튼을 눌러주세요 (10분 후 자동 취소)",
    ].join("\n");

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
