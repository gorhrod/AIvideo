import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'KWJMvideoAI',
  description: '블로그 데이터나 텍스트로 영상 스토리보드를 자동으로 만들어주는 앱',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
