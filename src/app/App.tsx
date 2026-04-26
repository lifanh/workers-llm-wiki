import { useState, useEffect } from "react";
import { useAgent } from "agents/react";
import { useAgentChat } from "@cloudflare/ai-chat/react";
import { ChatPanel } from "./components/ChatPanel";
import { Sidebar } from "./components/Sidebar";
import { PageViewer } from "./components/PageViewer";

type WikiState = {
  wikiId: string;
  pageCount: number;
  sourceCount: number;
  lastActivity: string;
  currentOperation: string | null;
  pageIndex: Array<{
    id: string;
    title: string;
    category: string;
    summary: string | null;
  }>;
  sourceIndex: Array<{
    id: string;
    filename: string;
    status: string;
  }>;
};

export default function App() {
  const [selectedPage, setSelectedPage] = useState<string | null>(null);
  const [selectedSource, setSelectedSource] = useState<string | null>(null);
  const [pageContent, setPageContent] = useState<string | null>(null);
  const [pageLoading, setPageLoading] = useState<boolean>(false);

  const agent = useAgent<WikiState>({
    agent: "WikiAgent",
  });

  const chat = useAgentChat({ agent });

  const wikiState = agent.state;

  const handlePageSelect = async (pageId: string) => {
    setSelectedPage(pageId);
    setSelectedSource(null);
    setPageContent(null);
    setPageLoading(true);
    try {
      const res = await fetch(`/api/wiki/${pageId}`);
      if (res.ok) {
        setPageContent(await res.text());
      }
    } finally {
      setPageLoading(false);
    }
  };

  const handleSourceSelect = async (filename: string) => {
    setSelectedSource(filename);
    setSelectedPage(null);
    setPageContent(null);
    setPageLoading(true);
    try {
      const res = await fetch(`/api/sources/${filename}`);
      if (res.ok) {
        setPageContent(await res.text());
      }
    } finally {
      setPageLoading(false);
    }
  };

  // Re-fetch currently viewed page when agent updates wiki state
  useEffect(() => {
    if (!selectedPage) return;
    fetch(`/api/wiki/${selectedPage}`)
      .then((res) => (res.ok ? res.text() : null))
      .then((text) => {
        if (text !== null) setPageContent(text);
      });
  }, [wikiState?.pageIndex, selectedPage]);

  // Re-fetch currently viewed source when agent updates source state
  useEffect(() => {
    if (!selectedSource) return;
    fetch(`/api/sources/${selectedSource}`)
      .then((res) => (res.ok ? res.text() : null))
      .then((text) => {
        if (text !== null) setPageContent(text);
      });
  }, [wikiState?.sourceIndex, selectedSource]);

  return (
    <div className="flex h-screen bg-gray-50">
      <Sidebar
        pageIndex={wikiState?.pageIndex ?? []}
        pageCount={wikiState?.pageCount ?? 0}
        sourceCount={wikiState?.sourceCount ?? 0}
        sourceIndex={wikiState?.sourceIndex ?? []}
        currentOperation={wikiState?.currentOperation ?? null}
        selectedPage={selectedPage}
        selectedSource={selectedSource}
        onPageSelect={handlePageSelect}
        onSourceSelect={handleSourceSelect}
      />

      <div className="flex flex-1 min-w-0">
        <ChatPanel chat={chat} />

        {(selectedPage || selectedSource) && (
          <PageViewer
            pageId={selectedPage ?? selectedSource!}
            content={pageContent}
            loading={pageLoading}
            onClose={() => {
              setSelectedPage(null);
              setSelectedSource(null);
              setPageContent(null);
            }}
            onNavigate={handlePageSelect}
          />
        )}
      </div>
    </div>
  );
}
