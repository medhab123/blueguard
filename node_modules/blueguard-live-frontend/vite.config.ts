import { defineConfig } from "vite"
import path from "path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src")
    }
  },
  server: {
    host: "0.0.0.0",
    port: 5173,
    strictPort: true,
    proxy: {
      "/api/obis": {
        target: "https://api.obis.org",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api\/obis/, "/v3/occurrence")
      },
      "/api/gbif": {
        target: "https://api.gbif.org",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api\/gbif/, "/v1/occurrence/search")
      },
      "/api/inat": {
        target: "https://api.inaturalist.org",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api\/inat/, "/v1/observations")
      },
      "/api/openmeteo": {
        target: "https://marine-api.open-meteo.com",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api\/openmeteo/, "/v1/marine")
      },
      "/api/noaa": {
        target: "https://coastwatch.noaa.gov",
        changeOrigin: true,
        rewrite: (p) =>
          p.replace(
            /^\/api\/noaa/,
            "/erddap/griddap/noaacwN20VIIRSchlaWeekly.csv"
          )
      },
      "/ws/ais": {
        target: "wss://stream.aisstream.io",
        changeOrigin: true,
        ws: true,
        rewrite: (p) => p.replace(/^\/ws\/ais/, "/v0/stream")
      }
    }
  }
})
