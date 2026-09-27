import MarkdownConverter from "@/components/markdown-converter";

export default function Home() {
  return (
    <main className="flex h-dvh flex-col overflow-hidden bg-zinc-50 font-sans dark:bg-black">
      <MarkdownConverter />
    </main>
  );
}