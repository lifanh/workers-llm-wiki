import { useState, useRef, useEffect } from "react";
import type { useAgentChat } from "@cloudflare/ai-chat/react";

type ChatPanelProps = {
  chat: ReturnType<typeof useAgentChat>;
};

export function ChatPanel({ chat }: ChatPanelProps) {
  const { messages, sendMessage, clearHistory, status } = chat;
  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    sendMessage({ text: input });
    setInput("");
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const content = reader.result as string;
      sendMessage({
        text: `Please ingest this file: ${file.name}\n\n---\n\n${content}`,
      });
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  return (
    <div className="flex flex-col flex-1 min-w-0">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && (
          <div className="text-center text-gray-400 mt-20">
            <h2 className="text-xl font-semibold mb-2">LLM Wiki</h2>
            <p>Upload sources, ask questions, or request a wiki lint.</p>
          </div>
        )}

        {messages.map((msg: any) => (
          <div
            key={msg.id}
            className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[80%] rounded-lg px-4 py-2 ${
                msg.role === "user"
                  ? "bg-blue-600 text-white"
                  : "bg-white border border-gray-200"
              }`}
            >
              {msg.parts.map((part: any, i: any) => {
                if (part.type === "text") {
                  return (
                    <div key={i} className="whitespace-pre-wrap">
                      {part.text}
                    </div>
                  );
                }
                if (part.type === "tool-invocation") {
                  return (
                    <details
                      key={part.toolCallId}
                      className="text-xs text-gray-500 mt-1"
                    >
                      <summary className="cursor-pointer">
                        🔧 {part.toolName}
                        {part.state === "result" ? " ✓" : " ..."}
                      </summary>
                      {part.state === "result" && (
                        <pre className="mt-1 overflow-x-auto">
                          {JSON.stringify(part.result, null, 2)}
                        </pre>
                      )}
                    </details>
                  );
                }
                return null;
              })}
            </div>
          </div>
        ))}

        {status === "streaming" && (
          <div className="text-gray-400 text-sm">Agent is thinking...</div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="border-t border-gray-200 p-4 bg-white">
        <form onSubmit={handleSubmit} className="flex gap-2">
          <label className="flex items-center cursor-pointer text-gray-400 hover:text-gray-600">
            <span className="text-xl">📎</span>
            <input
              type="file"
              className="hidden"
              accept=".md,.txt,.pdf,.json,.csv"
              onChange={handleFileUpload}
            />
          </label>

          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask a question, paste a source, or request a lint..."
            className="flex-1 border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            disabled={status === "streaming"}
          />

          <button
            type="submit"
            disabled={status === "streaming" || !input.trim()}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            Send
          </button>

          <button
            type="button"
            onClick={clearHistory}
            className="text-gray-400 hover:text-gray-600 px-2"
            title="Clear chat history"
          >
            🗑️
          </button>
        </form>
      </div>
    </div>
  );
}
