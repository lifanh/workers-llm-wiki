import { useState } from "react";

type WikiSelectorProps = {
  currentWikiId: string;
  onWikiChange: (wikiId: string) => void;
};

export function WikiSelector({
  currentWikiId,
  onWikiChange,
}: WikiSelectorProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [value, setValue] = useState(currentWikiId);

  const handleSubmit = () => {
    const trimmed = value.trim();
    if (trimmed && trimmed !== currentWikiId) {
      onWikiChange(trimmed);
    }
    setIsEditing(false);
  };

  if (isEditing) {
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleSubmit();
        }}
        className="flex gap-1"
      >
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="border border-gray-300 rounded px-2 py-0.5 text-xs w-24"
          autoFocus
          onBlur={handleSubmit}
        />
      </form>
    );
  }

  return (
    <button
      onClick={() => setIsEditing(true)}
      className="text-xs text-gray-500 hover:text-gray-700"
      title="Click to switch wiki"
    >
      Wiki: {currentWikiId}
    </button>
  );
}
