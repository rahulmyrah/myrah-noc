FROM nginx:1.27-alpine
COPY . /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 4000
CMD ["nginx", "-g", "daemon off;"]
