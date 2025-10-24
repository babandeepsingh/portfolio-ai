"use client";

import { useState, useRef, useEffect } from "react";
import Markdown from 'react-markdown'
import './styles.css'

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
}

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  // 👇 References for scrolling
  const chatContainerRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const noMessages = messages.length === 0;

  // 👇 Scrolls to bottom whenever messages change
  useEffect(() => {
    if (!chatContainerRef.current) return;
    chatContainerRef.current.scrollTo({
      top: chatContainerRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      content: input,
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsLoading(true);

    const assistantMessageId = (Date.now() + 1).toString();
    const assistantMessage: Message = {
      id: assistantMessageId,
      role: "assistant",
      content: "",
    };

    setMessages((prev) => [...prev, assistantMessage]);

    try {
      abortControllerRef.current = new AbortController();

      const transformedMessages = [...messages, userMessage].map((msg) => ({
        role: msg.role,
        parts: [{ type: "text", text: msg.content }],
      }));

      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: transformedMessages }),
        signal: abortControllerRef.current.signal,
      });

      if (!response.ok) throw new Error("Failed to fetch");

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) throw new Error("No reader available");

      let accumulatedContent = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        accumulatedContent += chunk;

        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === assistantMessageId
              ? { ...msg, content: accumulatedContent }
              : msg
          )
        );
      }
    } catch (error) {
      if (error instanceof Error && error.name !== "AbortError") {
        console.error("Error:", error);
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === assistantMessageId
              ? { ...msg, content: "Sorry, an error occurred." }
              : msg
          )
        );
      }
    } finally {
      setIsLoading(false);
      abortControllerRef.current = null;
    }
  };

  return (
    <div className="flex flex-col h-screen w-full bg-[#0e0e10] text-white font-sans">
      {/* Header */}
      <header className="py-6 px-4 md:px-8 border-b border-gray-800 shadow-sm bg-[#121212]">
        <h1 className="text-2xl md:text-4xl font-bold tracking-tight text-center">
          Babandeep’s AI Portfolio 🤖
        </h1>
      </header>

      {/* 👇 Chat Scrollable Container */}
      <div
        ref={chatContainerRef}
        className="flex-1 overflow-y-auto px-4 py-6 md:px-8 space-y-4 scrollbar-thin-custom"
      >
        {noMessages ? (
          <p className="text-center text-gray-400 text-lg mt-20">
            Ask me anything to get started ✨
          </p>
        ) : (
          messages.map((message) => (
            <div
              key={message.id}
              className={`flex ${
                message.role === "user" ? "justify-end" : "justify-start"
              }`}
            >
              <div
                className={`max-w-[80%] md:max-w-[60%] px-4 py-3 rounded-2xl text-sm md:text-base leading-relaxed shadow 
                  ${
                    message.role === "user"
                      ? "bg-blue-600 rounded-br-none"
                      : "bg-[#1f1f22] rounded-bl-none border border-gray-700"
                  }`}
              >
                <span className="block font-semibold mb-1">
                  {message.role === "user" ? "You" : "Babandeep"}
                </span>
                <div className="whitespace-pre-wrap">{message.role === "user" ?  message.content : <Markdown>{message.content}</Markdown>}</div>
              </div>
            </div>
          ))
        )}

        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-[#1f1f22] text-gray-400 px-4 py-3 rounded-2xl rounded-bl-none shadow text-sm animate-pulse">
              Babandeep is thinking... 🤔
            </div>
          </div>
        )}

        {/* 👇 Marker for bottom */}
        <div ref={bottomRef} />
      </div>

      {/* Footer / Input */}
      <footer className="border-t border-gray-800 bg-[#121212] px-4 py-4 md:px-8 sticky bottom-0">
        <form onSubmit={handleSubmit} className="flex items-center gap-3">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type your message..."
            disabled={isLoading}
            className="flex-1 px-4 py-3 rounded-full bg-[#1f1f22] border border-gray-700 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
          />
          <button
            type="submit"
            disabled={isLoading}
            className="bg-blue-600 hover:bg-blue-700 text-white px-5 py-2 rounded-full transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Send
          </button>
        </form>
      </footer>
    </div>
  );
}
