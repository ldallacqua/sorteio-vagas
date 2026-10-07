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

Tudo fica salvo no próprio aparelho, e uma cópia vai junto no endereço da página: se o
navegador apagar os dados do site (o Safari do iPhone faz isso depois de uma semana sem
uso), reabrir a mesma aba ou um favorito dela traz a lista de volta. Para passar a lista
para outro aparelho, copie o endereço da página ou use *Opções › Copiar link com a minha
lista*. Depois de aberto uma vez, o app funciona sem internet e pode ser instalado na tela
inicial (no iPhone, o app instalado guarda os dados separado do Safari: monte a lista já
nele, ou leve-a pelo link).

Se a sua lista acabar antes da sua vez, o app sugere a vaga livre mais perto da sua
1ª opção.

## O mapa

O desenho sai direto do PDF oficial do mapa de vagas, que é vetorial: 211 vagas, 2 vagas
PCD e a do zelador, que não entram no sorteio. `dev/extract_map.py` lê do PDF o contorno
de cada vaga, o número e a linha colorida de tamanho (grande, média ou pequena) e gera
`data.js` e `img/mapa-original.jpg`; `dev/overlay.html` sobrepõe o desenho ao mapa
original para conferir.

```bash
pip install pymupdf shapely
python dev/extract_map.py caminho/para/mapa.pdf
```

São 11 vagas grandes, 95 médias e 105 pequenas.

## Desenvolvimento

Site estático, sem build: HTML, CSS e JavaScript puros, com as fontes (Barlow, licença OFL)
servidas da pasta `fonts/`.

```bash
python -m http.server 8790
```

Em `localhost` o service worker fica desligado, para não servir arquivos antigos; abra com
`?sw` para ligá-lo. No site publicado ele busca a versão mais nova quando há sinal e
responde do cache quando não há, ou quando a rede demora.

## Testes

`tests/bughunt.mjs` abre o app no WebKit (o motor do Safari) e no Chromium, nos tamanhos do
iPhone 17 Pro Max e do iPad Pro 13" (em pé e deitados) e de um iPhone SE, e percorre tudo com
toques: montar a lista, arrastar, riscar vagas, "é a minha vez", recarregar no meio, dados
corrompidos, duas abas, navegador que não grava, e abrir sem internet. Também confere o
layout de cada tela (nada fora da tela, sobreposto ou cortado) e salva capturas em
`tests/shots/`.

```bash
cd tests
npm install
npx playwright install webkit
npm test
```

O Chromium usado é o Edge já instalado. O WebKit do Playwright é o mesmo motor do Safari,
mas não é o Safari do iOS: o teclado do sistema, a barra de endereço que encolhe e os gestos
de dois dedos de verdade só dá para conferir num aparelho.
