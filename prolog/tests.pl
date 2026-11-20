/*  Pruebas de la IA de Battleship.

    swipl -g run_tests -t halt tests.pl
*/
:- use_module(library(plunit)).
:- use_module(battleship_ai).

:- begin_tests(coordenadas).

test(ida_y_vuelta) :-
    coord_celda('B7', C), C == 2-7,
    coord_celda(X, 10-10), X == 'J10'.

test(desde_string) :-
    coord_celda("A1", C), C == 1-1.

:- end_tests(coordenadas).

:- begin_tests(colocaciones).

%   En un tablero de 10, un barco de 5 entra en 6 posiciones por fila y 6 por columna:
%   6 * 10 horizontales + 6 * 10 verticales = 120.
test(cantidad) :-
    aggregate_all(count, colocacion(10, 5, _), 120).

test(dentro_del_tablero) :-
    forall(colocacion(4, 3, Celdas),
           forall(member(F-C, Celdas), (between(1, 4, F), between(1, 4, C)))).

:- end_tests(colocaciones).

:- begin_tests(hunt).

%   Tablero vacio: el centro tiene mas colocaciones que las esquinas, asi que no dispara a una
%   esquina. Y es determinista: siempre la misma jugada.
test(tablero_vacio_va_al_centro) :-
    mejor_disparo(10, [], [5, 4, 3, 3, 2], F-C, Modo, _),
    Modo == hunt,
    between(4, 7, F), between(4, 7, C),
    mejor_disparo(10, [], [5, 4, 3, 3, 2], Otra, _, _),
    Otra == F-C.

test(densidad_esquina_menor_que_centro) :-
    densidad(10, [], [3], Pares),
    memberchk(PE-(1-1), Pares), memberchk(PC-(5-5), Pares),
    PE < PC.

%   Una celda rodeada de agua no puede tener un barco de 2 o mas: densidad 0, no se elige.
test(no_dispara_a_celda_imposible) :-
    Agua = [shot(1,2,miss), shot(2,1,miss)],
    densidad(3, Agua, [2], Pares),
    \+ memberchk(_-(1-1), Pares).

test(no_repite_disparos) :-
    findall(shot(F, C, miss), (between(1, 3, F), between(1, 3, C), F-C \== 3-3), Agua),
    mejor_disparo(3, Agua, [1], Celda, _, _),
    Celda == 3-3.

:- end_tests(hunt).

:- begin_tests(target).

%   Un tocado suelto: dispara a una vecina.
test(tocado_suelto_va_a_vecina) :-
    mejor_disparo(10, [shot(5,5,hit)], [5, 4, 3, 3, 2], F-C, Modo, Razon),
    Modo == target,
    memberchk(F-C, [4-5, 6-5, 5-4, 5-6]),
    once(sub_atom(Razon, _, _, _, junto)).

%   Dos tocados alineados en horizontal: prolonga la linea, no se va en vertical.
test(dos_tocados_prolonga_la_linea) :-
    mejor_disparo(10, [shot(5,5,hit), shot(5,6,hit)], [5, 4, 3, 3, 2], Celda, target, Razon),
    memberchk(Celda, [5-4, 5-7]),
    once(sub_atom(Razon, _, _, _, linea)).

%   Si un extremo de la linea ya es agua, va al otro.
test(extremo_bloqueado_va_al_otro) :-
    mejor_disparo(10, [shot(5,4,miss), shot(5,5,hit), shot(5,6,hit)], [5, 4, 3, 3, 2], Celda, target, _),
    Celda == 5-7.

%   Las celdas de un barco hundido no son tocados pendientes: vuelve a cazar.
test(hundido_vuelve_a_cazar) :-
    mejor_disparo(10, [shot(1,1,sunk), shot(1,2,sunk)], [5, 4, 3, 3], _, Modo, _),
    Modo == hunt.

:- end_tests(target).

:- begin_tests(partida_completa).

%   Juega contra una flota fija hasta hundirla: la IA debe terminar sin repetir disparos y en
%   bastantes menos de 100 tiros (al azar el promedio ronda los 95).
test(hunde_la_flota) :-
    Flota = [ [1-1,1-2,1-3,1-4,1-5], [3-3,4-3,5-3,6-3], [8-8,8-9,8-10], [10-1,10-2,10-3], [6-6,7-6] ],
    jugar(Flota, [], [5,4,3,3,2], 0, Tiros),
    Tiros =< 70.

jugar(_, _, [], Tiros, Tiros) :- !.
jugar(Flota, Disparos, Restantes, T0, Tiros) :-
    T0 < 100,
    mejor_disparo(10, Disparos, Restantes, Celda, _, _),
    Celda = F-C,
    \+ memberchk(shot(F, C, _), Disparos),
    T1 is T0 + 1,
    (   member(Barco, Flota), memberchk(F-C, Barco)
    ->  D1 = [shot(F, C, hit)|Disparos],
        (   forall(member(X-Y, Barco), memberchk(shot(X, Y, hit), D1))
        ->  hundir(Barco, D1, D2),
            length(Barco, L), selectchk(L, Restantes, R1)
        ;   D2 = D1, R1 = Restantes
        )
    ;   D2 = [shot(F, C, miss)|Disparos], R1 = Restantes
    ),
    jugar(Flota, D2, R1, T1, Tiros).

%   Cuando un barco se hunde, sus celdas pasan de hit a sunk (es lo que hace la consola).
hundir(Barco, D0, D) :-
    foldl([X-Y, A0, A]>>( selectchk(shot(X, Y, hit), A0, A1), A = [shot(X, Y, sunk)|A1] ), Barco, D0, D).

:- end_tests(partida_completa).
