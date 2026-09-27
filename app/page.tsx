import { redirect } from "next/navigation";

/** The manuscript editor is the default tool. */
export default function Home() {
  redirect("/manuscript-editor");
}
