export default function NotFound() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50">
      <h1 className="text-4xl font-bold mb-4">Page Not Found</h1>
      <p className="text-lg text-gray-600">The page you were looking for could not be found.</p>
      <a href="/" className="mt-6 text-blue-500 underline">Return Home</a>
    </div>
  );
} 