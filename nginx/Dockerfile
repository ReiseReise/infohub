FROM node:22-alpine AS web-builder

WORKDIR /web
COPY apps/web/package*.json ./
RUN npm ci
COPY apps/web/ ./
RUN npm run build

FROM nginx:alpine

COPY nginx/nginx.conf /etc/nginx/nginx.conf
# Fail closed in a clean build. Deployments may mount a real ignored htpasswd
# over this placeholder through docker-compose.ops-auth.yml.
RUN printf 'disabled:!\n' > /etc/nginx/ops.htpasswd \
    && chmod 0444 /etc/nginx/ops.htpasswd
COPY --from=web-builder /web/dist /usr/share/nginx/html
