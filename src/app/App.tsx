import { useState } from "react";
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
};

export default function App() {
  const [selectedPage, setSelectedPage] = useState<string | null>(null);
  const [pageContent, setPageContent] = useState<string | null>(null);

  const agent = useAgent<WikiState>({
    agent: "WikiAgent",
  });

  const chat = useAgentChat({ agent });

  const wikiState = agent.state;

  const handlePageSelect = async (pageId: string) => {
    setSelectedPage(pageId);
    setPageContent(null);
  };

  return (
    <div className="flex h-screen bg-gray-50">
      <Sidebar
        pageIndex={wikiState?.pageIndex ?? []}
        pageCount={wikiState?.pageCount ?? 0}
        sourceCount={wikiState?.sourceCount ?? 0}
        currentOperation={wikiState?.currentOperation ?? null}
        selectedPage={selectedPage}
        onPageSelect={handlePageSelect}
      />

      <div className="flex flex-1 min-w-0">
        <ChatPanel chat={chat} />

        {selectedPage && (
          <PageViewer
            pageId={selectedPage}
            content={pageContent}
            onClose={() => {
              setSelectedPage(null);
              setPageContent(null);
            }}
          />
        )}
      </div>
    </div>
  );
}
