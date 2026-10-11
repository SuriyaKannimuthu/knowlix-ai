import type { Metadata } from "next";
import { AssistantApp } from "@/components/assistant/AssistantApp";

export const metadata: Metadata = {
  title: "Assistant",
  description: "Upload documents and ask questions with grounded, cited answers.",
};

export default function AssistantPage() {
  return <AssistantApp />;
}
