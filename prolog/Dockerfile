# Servicio de IA en Prolog (SWI-Prolog). Misma version con la que pasan las pruebas plunit.
#
#   docker build -t gameconsole-prolog prolog/
#   docker run --rm -p 8090:8090 gameconsole-prolog

FROM swipl:10.0.2

WORKDIR /app
COPY battleship_ai.pl server.pl tests.pl ./

# Si las pruebas fallan, la imagen no se construye.
RUN swipl -g run_tests -t halt tests.pl

ENV PORT=8090
EXPOSE 8090
HEALTHCHECK --interval=5s --timeout=3s --start-period=5s --retries=10 \
  CMD swipl -g "use_module(library(http/http_open)),http_open('http://127.0.0.1:8090/health',S,[]),close(S)" -t halt || exit 1

CMD ["swipl", "server.pl"]
