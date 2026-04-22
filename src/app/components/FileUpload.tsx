import { useCallback, useState } from "react";

type FileUploadProps = {
  onFileSelected: (file: { name: string; content: string }) => void;
};

export function FileUpload({ onFileSelected }: FileUploadProps) {
  const [isDragging, setIsDragging] = useState(false);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);

      const file = e.dataTransfer.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = () => {
        onFileSelected({
          name: file.name,
          content: reader.result as string,
        });
      };
      reader.readAsText(file);
    },
    [onFileSelected],
  );

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
      className={`border-2 border-dashed rounded-lg p-4 text-center text-sm cursor-pointer transition-colors ${
        isDragging
          ? "border-blue-500 bg-blue-50 text-blue-600"
          : "border-gray-300 text-gray-400 hover:border-gray-400"
      }`}
    >
      Drop a file here to ingest
    </div>
  );
}
