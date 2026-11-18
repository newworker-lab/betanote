"""Typeset synthetic two-column papers (Typst) for the translation audit when
real papers are not at hand: display equations with run-in labels, equations
side by side, inline hats/subscripts, centred caption lines above headings,
full-width figures, tables. The text is generated, not copied from papers.

  pip install typst==0.15.0
  python3 tests/typeset-papers.py /tmp/typeset   # then APP_AUDIT_DIR=/tmp/typeset
"""
import random, sys, pathlib, typst

out = pathlib.Path(sys.argv[1]); out.mkdir(parents=True, exist_ok=True)
R = random.Random(42)
SUBJ = ["The growth rate", "The biomass yield", "Substrate uptake", "The lag phase", "Oxygen transfer", "The hierarchical model", "The posterior estimate", "Cell density", "The dilution rate", "Product formation"]
VERB = ["depends strongly on", "was estimated from", "decreases with", "is proportional to", "remained stable under", "was compared against", "is limited by", "increases with", "was corrected for", "is sensitive to"]
OBJ = ["the initial glucose concentration", "the dissolved oxygen level", "replicate cultures", "the temperature shift", "the measured optical density", "the specific growth rate", "the false discovery rate", "the feed composition", "nitrogen limitation", "the sampling interval"]
TAIL = ["in all reactors.", "across the three strains.", "within the exponential phase.", "after 24 h of cultivation.", "as shown in the previous section.", "under fed-batch conditions.", "with a 95% credible interval.", "for each experimental block."]

def sentence():
    return f"{R.choice(SUBJ)} {R.choice(VERB)} {R.choice(OBJ)} {R.choice(TAIL)}"

def para(n=6):
    return " ".join(sentence() for _ in range(n))

def inline_para():
    # inline math with hats and subscripts, as in "F̂DR" and X_biomass
    return (f"{sentence()} The adjusted estimate $hat(F)\"DR\"$ stayed below $0.05$ while "
            f"$X_\"biomass\"$ reached $4.2 \"g L\"^(-1)$ and $mu_max = 0.31 \"h\"^(-1)$. {para(4)}")

HEAD = '''#set page(paper: "a4", margin: (x: 1.6cm, y: 2cm), columns: 2)
#set columns(gutter: 0.6cm)
#set text(size: 9.5pt, lang: "en")
#set par(justify: true, leading: 0.55em, first-line-indent: 1em, spacing: 0.6em)
#show heading: set text(size: 10.5pt)
#place(top + center, scope: "parent", float: true, block(width: 100%)[
  #align(center, text(15pt, weight: "bold")[TITLE])
  #v(0.3em)
  #align(center)[A. Author, B. Researcher]
  #v(0.6em)
  #block(width: 100%, inset: (x: 1cm))[#par(first-line-indent: 0em)[*Abstract.* ABSTRACT]]
  #v(0.8em)
])
'''

def labelled_equations():
    # run-in label lines followed by display equations
    return f'''
*Total biomass ($X_"biomass"$):*
$ (d A_3)/(d t) = mu_max (S)/(K_S + S) A_3 - k_d A_3 $
*Substrate balance ($S$):*
$ (d S)/(d t) = -1/Y_(X S) mu_max (S)/(K_S + S) X + D (S_0 - S) $
{para(5)}
'''

def side_by_side():
    # two equations next to each other, the second reaching the column edge
    return f'''
#grid(columns: (1fr, 1fr), gutter: 4pt,
  [$ r_1 = k_1 C_A^(alpha) $], [$ r_2 = k_2 C_B C_A^(beta) $])
{para(4)}
#grid(columns: (1fr, 1fr), gutter: 4pt,
  [$ hat(theta) = arg max_theta ell(theta) $ (4)], [$ sigma^2 = 1/(n-1) sum_i (x_i - macron(x))^2 $ (5)])
'''

def figure(caption_sentences, full=False, h="3.4cm"):
    cap = " ".join(sentence() for _ in range(caption_sentences))
    scope = ', placement: top, scope: "parent"' if full else ''
    return f'\n#figure(rect(width: 100%, height: {h}, fill: rgb("#d8e4f0"), stroke: rgb("#4a6fa5")){scope}, caption: [{cap}])\n'

def table():
    rows = "\n".join(f"  [{R.choice(['A','B','C'])}{i}], [{R.uniform(0.1,0.9):.2f}], [{R.uniform(1,9):.1f}], [{R.choice(['batch','fed-batch','chemostat'])}]," for i in range(6))
    return f'''
#figure(table(columns: 4, stroke: none, table.hline(),
  [*Strain*], [*$mu$ (h$""^(-1)$)*], [*Yield*], [*Mode*], table.hline(),
{rows}
  table.hline()), caption: [{sentence()} {sentence()}])
'''

def paper(title, sections):
    body = HEAD.replace("TITLE", title).replace("ABSTRACT", para(5))
    for i, (name, parts) in enumerate(sections, 1):
        body += f"\n= {i}. {name}\n" + "\n\n".join(parts) + "\n"
    return body

papers = {
  "S01-equations.pdf": paper("Kinetic models of microbial growth", [
      ("Introduction", [para(7), inline_para(), para(6)]),
      ("Model", [para(5), labelled_equations(), inline_para(), side_by_side(), para(6)]),
      ("Results", [para(7), labelled_equations(), para(7), inline_para()]),
      ("Discussion", [para(8), para(6)])]),
  "S02-captions.pdf": paper("Imaging of biofilm formation", [
      ("Introduction", [para(7), para(5)]),
      ("Methods", [para(4), figure(3), para(5), figure(5, h="2.4cm"), para(3)]),
      ("Results", [figure(2, full=True), para(6), para(4), figure(4), para(6), table(), para(5)]),
      ("Conclusions", [para(7), figure(2, h="2cm"), para(3)])]),
  "S03-mixed.pdf": paper("Bayesian calibration of fed-batch reactors", [
      ("Background", [inline_para(), para(6), side_by_side()]),
      ("Inference", [para(5), labelled_equations(), figure(3), inline_para(), table()]),
      ("Evaluation", [figure(3, full=True, h="4cm"), para(8), inline_para(), para(5), figure(2), para(6)])]),
}
for name, src in papers.items():
    (out / name).write_bytes(typst.compile(src.encode()))
print("wrote", len(papers), "papers to", out)
