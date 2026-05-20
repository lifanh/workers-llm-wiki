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
    source_type: string;
    source_url: string | null;
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
  const selectedPageEntry = wikiState?.pageIndex.find((page) => page.id === selectedPage) ?? null;
  const selectedSourceEntry =
    wikiState?.sourceIndex.find((source) => source.filename === selectedSource) ?? null;

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
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.16),_transparent_32%),linear-gradient(180deg,_#f8fafc_0%,_#eef2ff_100%)] p-4 text-slate-900 sm:p-6">
      <div className="flex h-[calc(100vh-2rem)] min-h-[42rem] overflow-hidden rounded-[28px] border border-white/70 bg-white/75 shadow-[0_24px_80px_rgba(15,23,42,0.14)] backdrop-blur xl:h-[calc(100vh-3rem)]">
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

        <div className="flex flex-1 min-w-0 bg-white/60">
          <ChatPanel chat={chat} />

          {(selectedPage || selectedSource) && (
            <PageViewer
              pageId={selectedPage ?? selectedSource!}
              title={selectedPageEntry?.title ?? selectedSourceEntry?.filename ?? selectedPage ?? selectedSource!}
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
    </div>
  );
}
