import Navbar from "@/components/Navbar";
import Hero from "@/components/Hero";
import Features from "@/components/Features";
import HowItWorks from "@/components/HowItWorks";
import QuickStart from "@/components/QuickStart";
import Providers from "@/components/Providers";
import Screenshots from "@/components/Screenshots";
import Privacy from "@/components/Privacy";
import AboutContact from "@/components/AboutContact";
import Footer from "@/components/Footer";
import ShareButtons from "@/components/ShareButtons";

export default function Home() {
  return (
    <main>
      <ShareButtons />
      <Navbar />
      <Hero />
      <Features />
      <HowItWorks />
      <QuickStart />
      <Providers />
      <Screenshots />
      <Privacy />
      <AboutContact />
      <Footer />
    </main>
  );
}
