/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: "#FF4A17",
          hover: "#E8450A",
          light: "#FFF0EC",
          dark: "#CC3A12",
        },
        ink: {
          DEFAULT: "#0F1115",
          light: "#1A1E26",
          muted: "#2A303C",
        },
        surface: "#F8F9FA",
      },
      fontFamily: {
        display: ["Raleway", "Inter", "system-ui", "sans-serif"],
        body: ["Inter", "Open Sans", "system-ui", "sans-serif"],
      },
      boxShadow: {
        card: "0 10px 30px -10px rgba(0,0,0,0.12)",
        soft: "0 4px 24px rgba(0,0,0,0.06)",
      },
    },
  },
  plugins: [],
};
