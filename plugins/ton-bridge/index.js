/**
 * TON Bridge Plugin — inline-native architecture
 *
 * Tools return structured inline result objects; no direct message sending.
 * The agent delivers results via answerInlineQuery.
 *
 * DEVELOPED BY TONY (AI AGENT) UNDER SUPERVISION OF ANTON POROSHIN
 * DEVELOPMENT STUDIO: https://github.com/xlabtg
 */

export const manifest = {
  name: "ton-bridge",
  version: "1.1.0",
  sdkVersion: ">=1.0.0",
  description:
    "TON Bridge inline-native plugin. Returns structured inline results for opening https://t.me/TONBridge_robot?startapp. Developed by Tony (AI Agent) under supervision of Anton Poroshin.",
  author: {
    name: "Tony (AI Agent)",
    role: "AI Developer",
    supervisor: "Anton Poroshin",
    link: "https://github.com/xlabtg",
  },
  bot: {
    inline: true,
  },
  defaultConfig: {
    enabled: true,
    buttonText: "TON Bridge No1",
    buttonEmoji: "",
    startParam: "",
  },
};

export function migrate(db) {
  // No database required for this plugin
}

export const tools = (sdk) => {
  const MINI_APP_URL = "https://t.me/TONBridge_robot?startapp";

  /**
   * Build the inline_keyboard reply_markup for the TON Bridge button.
   */
  function buildReplyMarkup(buttonText, buttonEmoji, startParam) {
    const label =
      buttonEmoji ? `${buttonEmoji} ${buttonText}` : buttonText;
    const url = startParam
      ? `${MINI_APP_URL}=${encodeURIComponent(startParam)}`
      : MINI_APP_URL;
    return {
      inline_keyboard: [[{ text: label, url }]],
    };
  }

  // Register inline query handler — fires when user types @botname <query>
  sdk.bot.onInlineQuery(async (ctx) => {
    const query = (ctx.query ?? "").trim().toLowerCase();
    const buttonText = sdk.pluginConfig.buttonText ?? "TON Bridge No1";
    const buttonEmoji = sdk.pluginConfig.buttonEmoji ?? "";
    const startParam = sdk.pluginConfig.startParam ?? "";

    const replyMarkup = buildReplyMarkup(buttonText, buttonEmoji, startParam);

    // Result 1: Open TON Bridge
    const openResult = {
      id: "ton_bridge_open",
      type: "article",
      title: "🌉 Open TON Bridge",
      description: "Open TON Bridge Mini App",
      input_message_content: {
        message_text: "🌉 **TON Bridge** — The #1 Bridge in the TON Catalog\n\nClick the button below to open TON Bridge Mini App.",
        parse_mode: "Markdown",
      },
      reply_markup: replyMarkup,
    };

    // Result 2: About TON Bridge
    const aboutResult = {
      id: "ton_bridge_about",
      type: "article",
      title: "ℹ️ About TON Bridge",
      description: "Info about TON Bridge Mini App",
      input_message_content: {
        message_text: "ℹ️ **About TON Bridge**\n\nTON Bridge is the #1 bridge in the TON Catalog. Transfer assets across chains seamlessly via the official Mini App.",
        parse_mode: "Markdown",
      },
      reply_markup: replyMarkup,
    };

    // Result 3: Custom message (shown when query is non-empty)
    const customResult = query
      ? {
          id: "ton_bridge_custom",
          type: "article",
          title: `🌉 TON Bridge — ${ctx.query}`,
          description: "Send custom message with TON Bridge button",
          input_message_content: {
            message_text: ctx.query,
          },
          reply_markup: replyMarkup,
        }
      : null;

    const results = [openResult, aboutResult];
    if (customResult) results.push(customResult);

    // Filter by query alias if provided
    if (query === "ton-bridge:open" || query === "ton_bridge_open") {
      return [openResult];
    }
    if (query === "ton-bridge:about" || query === "ton_bridge_about") {
      return [aboutResult];
    }

    return results;
  });

  return [
    // ── Tool: ton_bridge_open ──────────────────────────────────────────────
    {
      name: "ton_bridge_open",
      description:
        "Return an inline result to open TON Bridge Mini App. The result contains a button labeled 'TON Bridge No1' that opens https://t.me/TONBridge_robot?startapp. Use this tool when the user asks to open or access the TON Bridge.",
      category: "action",
      parameters: {
        type: "object",
        properties: {
          message: {
            type: "string",
            description: "Optional message text to display with the button",
            minLength: 1,
            maxLength: 500,
          },
        },
      },
      execute: async (params, context) => {
        try {
          const buttonText = sdk.pluginConfig.buttonText ?? "TON Bridge No1";
          const buttonEmoji = sdk.pluginConfig.buttonEmoji ?? "";
          const startParam = sdk.pluginConfig.startParam ?? "";

          const replyMarkup = buildReplyMarkup(buttonText, buttonEmoji, startParam);
          const label = buttonEmoji ? `${buttonEmoji} ${buttonText}` : buttonText;

          const messageText =
            params.message ??
            "🌉 **TON Bridge** — The #1 Bridge in the TON Catalog\n\nClick the button below to open TON Bridge Mini App.";

          sdk.log.info(
            `ton_bridge_open called by ${context.senderId} — button: "${label}"`
          );

          return {
            success: true,
            data: {
              type: "article",
              id: "ton_bridge",
              title: "🌉 Open TON Bridge",
              description: "Open TON Bridge Mini App",
              input_message_content: {
                message_text: messageText,
                parse_mode: "Markdown",
              },
              reply_markup: replyMarkup,
            },
          };
        } catch (err) {
          sdk.log.error("ton_bridge_open failed:", err.message);
          return { success: false, error: String(err.message || err).slice(0, 500) };
        }
      },
    },

    // ── Tool: ton_bridge_about ─────────────────────────────────────────────
    {
      name: "ton_bridge_about",
      description:
        "Return an inline result with info about TON Bridge. Includes a button to open the Mini App. Use this when the user asks about TON Bridge or wants more information.",
      category: "data-bearing",
      parameters: {
        type: "object",
        properties: {},
      },
      execute: async (params, context) => {
        try {
          const buttonText = sdk.pluginConfig.buttonText ?? "TON Bridge No1";
          const buttonEmoji = sdk.pluginConfig.buttonEmoji ?? "";
          const startParam = sdk.pluginConfig.startParam ?? "";

          const replyMarkup = buildReplyMarkup(buttonText, buttonEmoji, startParam);

          sdk.log.info(`ton_bridge_about called by ${context.senderId}`);

          return {
            success: true,
            data: {
              type: "article",
              id: "ton_bridge_about",
              title: "ℹ️ About TON Bridge",
              description: "Info about TON Bridge Mini App",
              input_message_content: {
                message_text:
                  "ℹ️ **About TON Bridge**\n\nTON Bridge is the #1 bridge in the TON Catalog. Transfer assets across chains seamlessly via the official Mini App.",
                parse_mode: "Markdown",
              },
              reply_markup: replyMarkup,
            },
          };
        } catch (err) {
          sdk.log.error("ton_bridge_about failed:", err.message);
          return { success: false, error: String(err.message || err).slice(0, 500) };
        }
      },
    },

    // ── Tool: ton_bridge_custom_message ────────────────────────────────────
    {
      name: "ton_bridge_custom_message",
      description:
        "Return an inline result with a custom message and TON Bridge button. Use when the user wants to share a specific message alongside the TON Bridge button.",
      category: "action",
      parameters: {
        type: "object",
        properties: {
          customMessage: {
            type: "string",
            description: "Custom message text to display with the button",
            minLength: 1,
            maxLength: 500,
          },
        },
        required: ["customMessage"],
      },
      execute: async (params, context) => {
        try {
          const buttonText = sdk.pluginConfig.buttonText ?? "TON Bridge No1";
          const buttonEmoji = sdk.pluginConfig.buttonEmoji ?? "";
          const startParam = sdk.pluginConfig.startParam ?? "";

          const replyMarkup = buildReplyMarkup(buttonText, buttonEmoji, startParam);

          sdk.log.info(
            `ton_bridge_custom_message called by ${context.senderId}`
          );

          return {
            success: true,
            data: {
              type: "article",
              id: "ton_bridge_custom",
              title: "🌉 TON Bridge — Custom Message",
              description: params.customMessage.slice(0, 100),
              input_message_content: {
                message_text: params.customMessage,
              },
              reply_markup: replyMarkup,
            },
          };
        } catch (err) {
          sdk.log.error("ton_bridge_custom_message failed:", err.message);
          return { success: false, error: String(err.message || err).slice(0, 500) };
        }
      },
    },
  ];
};
