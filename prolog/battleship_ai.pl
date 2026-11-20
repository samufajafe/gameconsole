/*  IA de Battleship (hundir la flota) para GameConsole.

    La consola le manda a Prolog lo que la IA SABE del tablero rival (sus disparos y que paso con
    cada uno, y que barcos le quedan por hundir) y Prolog contesta en que celda disparar. Prolog no
    conoce donde estan los barcos del humano: decide igual que una persona, con la informacion
    visible.

    Representacion
      - Una celda es Fila-Columna, las dos de 1 a N. La fila es la letra del contrato
        (A = 1 ... J = 10) y la columna el numero: "B7" es 2-7.
      - Un disparo es shot(Fila, Columna, Resultado), con Resultado en
          miss  : agua
          hit   : toco un barco que todavia NO se hundio (un "tocado pendiente")
          sunk  : la celda es de un barco ya hundido
      - Restantes es la lista de tamanos de los barcos que faltan por hundir, p. ej. [5,4,3,3,2].

    Estrategia (dos modos, como juega una persona)
      HUNT   (cazar)    No hay tocados pendientes. Se arma un MAPA DE DENSIDAD: para cada barco
                        restante se enumeran todas sus colocaciones posibles en el tablero (que no
                        pisen agua ni barcos hundidos) y cada celda suma 1 por cada colocacion que
                        la cubre. Se dispara a la celda libre con mas colocaciones: es donde mas
                        probablemente hay un barco.
      TARGET (rematar)  Hay tocados pendientes: hay un barco herido y hay que terminarlo.
                        Candidatas, en orden de preferencia:
                          1. "linea": celdas libres que prolongan dos tocados alineados;
                          2. "vecino": celdas libres pegadas (arriba/abajo/izq/der) a un tocado.
                        Entre las candidatas se elige la de mayor densidad, contando solo las
                        colocaciones que pasan por algun tocado.

    El desempate es determinista (la celda mas arriba y mas a la izquierda), asi que la misma
    situacion produce siempre la misma jugada y las pruebas son reproducibles. Nunca se dispara al
    azar.
*/
:- module(battleship_ai,
          [ mejor_disparo/6,      % +N, +Disparos, +Restantes, -Celda, -Modo, -Razon
            coord_celda/2,        % ?Coord (atomo "B7"), ?Fila-Columna
            colocacion/3,         % +N, +Tamano, -Celdas
            densidad/4            % +N, +Disparos, +Restantes, -Pares Puntaje-Celda
          ]).

:- use_module(library(lists)).
:- use_module(library(apply)).
:- use_module(library(pairs)).

%!  mejor_disparo(+N, +Disparos, +Restantes, -Celda, -Modo, -Razon) is det.
%
%   Punto de entrada. Elige el modo segun haya o no tocados pendientes y devuelve la celda, el
%   modo (hunt o target) y una explicacion en texto para mostrar en la consola y en AI_DECISION.
mejor_disparo(N, Disparos, Restantes, Celda, Modo, Razon) :-
    tocados_pendientes(Disparos, Tocados),
    (   Tocados == []
    ->  Modo = hunt,
        cazar(N, Disparos, Restantes, Celda, Puntaje),
        coord_celda(C, Celda),
        format(atom(Razon),
               'Caza: ~w colocaciones posibles de los barcos restantes pasan por ~w (la mayor densidad)',
               [Puntaje, C])
    ;   Modo = target,
        rematar(N, Disparos, Restantes, Tocados, Celda, Tipo, Puntaje),
        coord_celda(C, Celda),
        explicar_target(Tipo, C, Puntaje, Razon)
    ).

explicar_target(linea, C, P, Razon) :-
    format(atom(Razon), 'Remate: ~w prolonga una linea de tocados (densidad ~w)', [C, P]).
explicar_target(vecino, C, P, Razon) :-
    format(atom(Razon), 'Remate: ~w esta junto a un tocado (densidad ~w)', [C, P]).

%  --------------------------------------------------------------------------------------------
%  Modo HUNT

%   Densidad sobre todas las colocaciones validas; gana la celda libre con mas puntaje.
cazar(N, Disparos, Restantes, Celda, Puntaje) :-
    densidad(N, Disparos, Restantes, Pares),
    elegir(N, Disparos, Pares, Celda, Puntaje).

%!  densidad(+N, +Disparos, +Restantes, -Pares) is det.
%
%   Pares es una lista Puntaje-Celda: cuantas colocaciones validas de los barcos restantes cubren
%   cada celda. Se calcula de una sola pasada: se juntan TODAS las celdas de todas las colocaciones
%   validas en una lista, se ordena y se cuentan las repeticiones (como un histograma).
densidad(N, Disparos, Restantes, Pares) :-
    findall(Celda,
            ( member(T, Restantes),
              colocacion(N, T, Celdas),
              valida(Disparos, Celdas),
              member(Celda, Celdas)
            ),
            Todas),
    contar(Todas, Pares).

%  --------------------------------------------------------------------------------------------
%  Modo TARGET

rematar(N, Disparos, Restantes, Tocados, Celda, Tipo, Puntaje) :-
    densidad_por_tocados(N, Disparos, Restantes, Tocados, Pares),
    candidatas(N, Disparos, Tocados, Tipo, Candidatas),
    findall(P-C, (member(C, Candidatas), puntaje(Pares, C, P)), Puntuadas),
    mejor(Puntuadas, Puntaje-Celda).

%   Como densidad/4, pero solo con las colocaciones que pasan por al menos un tocado pendiente:
%   el barco herido tiene que estar en una de ellas.
densidad_por_tocados(N, Disparos, Restantes, Tocados, Pares) :-
    findall(Celda,
            ( member(T, Restantes),
              colocacion(N, T, Celdas),
              valida(Disparos, Celdas),
              member(H, Tocados), memberchk(H, Celdas),
              member(Celda, Celdas)
            ),
            Todas),
    contar(Todas, Pares).

%   Primero las que prolongan una linea; si no hay ninguna libre, las vecinas.
candidatas(N, Disparos, Tocados, Tipo, Candidatas) :-
    findall(C, (extremo_de_linea(Tocados, C), libre(N, Disparos, C)), L0),
    sort(L0, Linea),
    (   Linea \== []
    ->  Tipo = linea, Candidatas = Linea
    ;   findall(C, (member(H, Tocados), vecina(H, C), libre(N, Disparos, C)), V0),
        sort(V0, Vecinas),
        Tipo = vecino, Candidatas = Vecinas
    ).

%   C prolonga una linea si, en alguna direccion, las dos celdas siguientes son tocados.
extremo_de_linea(Tocados, F-C) :-
    member(F1-C1, Tocados),
    direccion(DF, DC),
    F2 is F1 + DF, C2 is C1 + DC,
    memberchk(F2-C2, Tocados),
    F is F1 - DF, C is C1 - DC.

vecina(F0-C0, F-C) :-
    direccion(DF, DC),
    F is F0 + DF, C is C0 + DC.

direccion(0, 1).
direccion(0, -1).
direccion(1, 0).
direccion(-1, 0).

%  --------------------------------------------------------------------------------------------
%  Colocaciones y tablero

%!  colocacion(+N, +T, -Celdas) is nondet.
%
%   Celdas que ocuparia un barco de tamano T, horizontal o vertical, dentro de un tablero NxN.
%   En backtracking enumera todas las posibles.
colocacion(N, T, Celdas) :-
    Max is N - T + 1,
    Max >= 1,
    between(1, N, Fija),
    between(1, Max, Inicio),
    Fin is Inicio + T - 1,
    (   findall(Fija-C, between(Inicio, Fin, C), Celdas)    % horizontal
    ;   findall(F-Fija, between(Inicio, Fin, F), Celdas)    % vertical
    ).

%   Una colocacion es valida si no pisa agua ni un barco ya hundido (si puede pasar por tocados).
valida(Disparos, Celdas) :-
    \+ ( member(F-C, Celdas),
         memberchk(shot(F, C, R), Disparos),
         R \== hit ).

libre(N, Disparos, F-C) :-
    between(1, N, F), between(1, N, C),
    \+ memberchk(shot(F, C, _), Disparos).

tocados_pendientes(Disparos, Tocados) :-
    findall(F-C, member(shot(F, C, hit), Disparos), T0),
    sort(T0, Tocados).

%  --------------------------------------------------------------------------------------------
%  Utilidades

%   Histograma: [a,b,a] -> [2-a, 1-b].
contar(Lista, Pares) :-
    msort(Lista, Ordenada),
    clumped(Ordenada, Grupos),           % [a-2, b-1]
    maplist(invertir, Grupos, Pares).    % [2-a, 1-b]

invertir(X-K, K-X).

puntaje(Pares, Celda, P) :-
    (   memberchk(P0-Celda, Pares) -> P = P0 ; P = 0 ).

%   Entre las celdas LIBRES, la de mas puntaje. Si ninguna tiene puntaje (no deberia pasar mientras
%   queden barcos), la primera libre: sigue siendo una regla, no azar.
elegir(N, Disparos, Pares, Celda, Puntaje) :-
    findall(P-C, (member(P-C, Pares), libre(N, Disparos, C)), Libres),
    (   Libres \== []
    ->  mejor(Libres, Puntaje-Celda)
    ;   once(libre(N, Disparos, Celda)), Puntaje = 0
    ).

%   Mayor puntaje; empate: la celda menor (mas arriba, mas a la izquierda).
mejor(Puntuadas, Puntaje-Celda) :-
    Puntuadas \== [],
    map_list_to_pairs(clave_orden, Puntuadas, ConClave),
    keysort(ConClave, [_-(Puntaje-Celda)|_]).

clave_orden(P-(F-C), k(NP, F, C)) :- NP is -P.

%  --------------------------------------------------------------------------------------------
%  Coordenadas del contrato

%!  coord_celda(?Coord, ?Celda) is det.
%
%   "B7" <-> 2-7. La letra es la fila (A..J) y el numero la columna (1..10), como en el patron
%   ^[A-J](10|[1-9])$ de GameStats.
coord_celda(Coord, F-C) :-
    nonvar(Coord), !,
    atom_string(Coord, S),
    sub_string(S, 0, 1, _, Letra),
    sub_string(S, 1, _, 0, Num),
    string_code(1, Letra, Code),
    F is Code - 0'A + 1,
    number_string(C, Num),
    F >= 1, C >= 1.
coord_celda(Coord, F-C) :-
    Code is 0'A + F - 1,
    format(atom(Coord), '~c~w', [Code, C]).
