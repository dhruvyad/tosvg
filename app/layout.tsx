import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'tosvg — convert images to SVG in your browser',
  description:
    'Upload a JPG/PNG/WebP/GIF/BMP and convert it to SVG entirely in your browser. No upload, no backend.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
