/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    // `next build`가 ESLint 미설정 시 대화형 설치 프롬프트를 띄우며 멈추는 것을 방지합니다.
    // 필요하면 `yarn lint`로 별도 실행하세요.
    ignoreDuringBuilds: true,
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'images.unsplash.com',
      },
    ],
  },
};

export default nextConfig;
