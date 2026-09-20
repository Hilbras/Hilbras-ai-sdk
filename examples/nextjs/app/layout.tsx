export const metadata = {
  title: "@hilbras/sdk Next.js Example",
  description: "Streaming chat and structured output with @hilbras/sdk",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
