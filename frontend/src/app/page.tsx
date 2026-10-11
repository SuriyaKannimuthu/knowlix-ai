import { CallToAction, Footer } from "@/components/landing/Closing";
import { Faq } from "@/components/landing/Faq";
import { Features } from "@/components/landing/Features";
import { Hero } from "@/components/landing/Hero";
import { HowItWorks } from "@/components/landing/HowItWorks";
import { Stack } from "@/components/landing/Stack";

export default function Home() {
  return (
    <main className="flex flex-col gap-3 p-3 md:gap-4 md:p-8">
      <Hero />
      <HowItWorks />
      <Features />
      <Stack />
      <Faq />
      <CallToAction />
      <Footer />
    </main>
  );
}
