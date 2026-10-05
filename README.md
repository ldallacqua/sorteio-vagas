# Sorteio de vagas

Ajudante para o sorteio de vagas de garagem do Allegro Jardim Avelino.
Você guarda a ordem das vagas que quer, vai riscando as que os vizinhos escolhem
e, quando chega a sua vez, o app mostra em número grande a melhor que sobrou.

**Abrir:** https://ldallacqua.github.io/sorteio-vagas/

## Como usar

1. **Lista**: monte a ordem de preferência. Toque nas vagas no mapa (da que você mais
   quer para a que menos quer) ou digite os números. Arraste para reordenar.
2. **Sorteio**: a cada vaga que alguém escolher, digite o número e toque em *Riscar*.
   O cartão do topo mostra sempre a sua melhor opção ainda livre.
3. **É a minha vez**: abre o número em tela cheia, com o plano B logo abaixo.

Tudo fica salvo no próprio aparelho. Para passar a lista do computador para o celular,
use *Opções › Copiar link com a minha lista*. Depois de aberto uma vez, o app funciona
sem internet e pode ser instalado na tela inicial.

Se a sua lista acabar antes da sua vez, o app sugere a vaga livre mais perto da sua
1ª opção.

## O mapa

O desenho foi refeito a partir da foto do mapa impresso (`img/mapa-original.jpg`):
211 vagas, 2 vagas PCD e a do zelador, que não entram no sorteio. As coordenadas e os
tamanhos ficam em `data.js`; `dev/overlay.html` sobrepõe o desenho à foto para conferir.

Os tamanhos (grande, média, pequena) foram lidos das linhas coloridas da foto.
Dois trechos ficaram duvidosos e vale conferir no papel: **036 a 058 pares** (lidas
como médias) e **062 a 068** (lidas como grandes). Para corrigir, edite os conjuntos
`GRANDES` e `PEQUENAS` no topo de `data.js`.

## Desenvolvimento

Site estático, sem build: HTML, CSS e JavaScript puros.

```bash
python -m http.server 8790
```

Em `localhost` o service worker não é registrado, para não servir arquivos antigos.
No site publicado o app abre do cache e se atualiza em segundo plano, então uma mudança
aparece na segunda abertura.
