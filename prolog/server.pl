/*  Servicio HTTP de la IA de Battleship (SWI-Prolog).

    POST /battleship/move
      Cuerpo:    { "size": 10,
                   "shots": [ { "coord": "A1", "result": "miss" | "hit" | "sunk" }, ... ],
                   "remaining": [5, 4, 3, 3, 2] }
      Respuesta: { "coord": "B7", "mode": "HUNT" | "TARGET", "reason": "..." }
      400 si el cuerpo no cumple ese formato.

    GET /health -> { "status": "ok", "service": "prolog-ai" }

    La consola llama a este servicio en cada turno de la maquina y ejecuta la jugada que devuelve.
    La logica esta en battleship_ai.pl; aqui solo se traduce JSON <-> terminos de Prolog.

    Uso:  swipl server.pl            (puerto 8090, o el de la variable PORT)
*/
:- use_module(library(http/thread_httpd)).
:- use_module(library(http/http_dispatch)).
:- use_module(library(http/http_json)).
:- use_module(library(http/json)).
:- use_module(battleship_ai).

:- http_handler(root(health), salud, [method(get)]).
:- http_handler(root(battleship/move), jugada, [method(post)]).

:- initialization(main, main).

main :-
    (   getenv('PORT', P), atom_number(P, Puerto) -> true ; Puerto = 8090 ),
    http_server(http_dispatch, [port(Puerto)]),
    format(user_error, "prolog-ai escuchando en :~w~n", [Puerto]),
    thread_get_message(_).                 % deja vivo el proceso principal

salud(_Request) :-
    reply_json_dict(_{status: "ok", service: "prolog-ai"}).

jugada(Request) :-
    catch(( http_read_json_dict(Request, Cuerpo),
            leer_estado(Cuerpo, N, Disparos, Restantes) ),
          Error,
          ( responder_error(Error), fail )),
    !,
    battleship_ai:mejor_disparo(N, Disparos, Restantes, Celda, Modo, Razon),
    coord_celda(Coord, Celda),
    upcase_atom(Modo, ModoMay),
    reply_json_dict(_{coord: Coord, mode: ModoMay, reason: Razon}).
jugada(_).                                 % el error ya se respondio

%   Traduce el JSON al estado que entiende battleship_ai. Lanza error(formato(Mensaje)) si algo no
%   cumple el formato, y eso se responde como 400.
leer_estado(Cuerpo, N, Disparos, Restantes) :-
    (   get_dict(size, Cuerpo, N), integer(N), N >= 1, N =< 26 -> true
    ;   throw(formato('size debe ser un entero entre 1 y 26')) ),
    (   get_dict(shots, Cuerpo, Shots), is_list(Shots) -> true
    ;   throw(formato('shots debe ser una lista')) ),
    (   get_dict(remaining, Cuerpo, Restantes), is_list(Restantes), Restantes \== [],
        forall(member(T, Restantes), (integer(T), T >= 1, T =< N)) -> true
    ;   throw(formato('remaining debe ser una lista no vacia de tamanos')) ),
    maplist(leer_disparo(N), Shots, Disparos).

leer_disparo(N, Shot, shot(F, C, R)) :-
    (   is_dict(Shot), get_dict(coord, Shot, Coord), get_dict(result, Shot, R0),
        atom_string(R, R0), memberchk(R, [miss, hit, sunk]),
        catch(coord_celda(Coord, F-C), _, fail),
        F =< N, C =< N
    ->  true
    ;   throw(formato('cada disparo es {coord, result} con result miss|hit|sunk'))
    ).

responder_error(formato(Mensaje)) :- !,
    reply_json_dict(_{error: Mensaje}, [status(400)]).
responder_error(_) :-
    reply_json_dict(_{error: "cuerpo JSON invalido"}, [status(400)]).
