FROM node:22-alpine AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG NEXT_PUBLIC_WAYMARK_API_URL=https://waymark-api-151782966477.asia-southeast1.run.app
ENV NEXT_PUBLIC_WAYMARK_API_URL=$NEXT_PUBLIC_WAYMARK_API_URL
RUN npm run build

FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY docker-entrypoint.sh /waymark-entrypoint.sh
RUN chmod +x /waymark-entrypoint.sh
COPY --from=build /src/out /usr/share/nginx/html
EXPOSE 8080
ENTRYPOINT ["/waymark-entrypoint.sh"]
