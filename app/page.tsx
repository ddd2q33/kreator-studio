import MarkdownConverter from "@/components/markdown-converter";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-1 flex-col bg-zinc-50 font-sans dark:bg-black">
      <MarkdownConverter />
    </main>
  );
}