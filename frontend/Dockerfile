# Static host for the sprint0 SPA on Cloud Run (Firebase Hosting blocked by org policy).
# Serves the prebuilt dist/ (built with VITE_API_BASE pointing at the gateway) on $PORT=8080.
FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY dist/ /usr/share/nginx/html/
EXPOSE 8080
