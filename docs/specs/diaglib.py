# Shared drawing primitives for FamilyHub spec diagrams.
# Reproduces the visual language of the personal-ledger spec PNGs:
# green (#35654D) header cards, monospace entity rows, dashed lifelines,
# pale section bands, solid request arrows / dashed reply arrows.
# Used by build-family-tab-diagrams.py. Pure matplotlib, no seaborn.
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch, FancyArrowPatch, Rectangle

GREEN = "#35654D"
GREEN_SOFT = "#e8efe9"   # pale band fill
GREEN_MID = "#5C6B63"    # muted grey-green text
INK = "#1D2621"
MUT = "#5C6B63"
BORDER = "#C7D2CA"
MONO = "DejaVu Sans Mono"
SANS = "DejaVu Sans"


def new_fig(w_px, h_px, dpi=100):
    fig = plt.figure(figsize=(w_px / dpi, h_px / dpi), dpi=dpi)
    ax = fig.add_axes([0, 0, 1, 1])
    ax.set_xlim(0, w_px)
    ax.set_ylim(0, h_px)
    ax.invert_yaxis()          # y grows downward, like reading order
    ax.axis("off")
    fig.patch.set_facecolor("white")
    return fig, ax


def title(ax, w, text, sub=None, y=46):
    ax.text(w / 2, y, text, ha="center", va="center", fontsize=17,
            fontweight="bold", color=INK, fontfamily=SANS)
    if sub:
        ax.text(w / 2, y + 30, sub, ha="center", va="center", fontsize=11.5,
                style="italic", color=MUT, fontfamily=SANS)


def rounded(ax, x, y, w, h, fc, ec="none", lw=0, r=8, z=2):
    p = FancyBboxPatch((x, y), w, h, boxstyle=f"round,pad=0,rounding_size={r}",
                       fc=fc, ec=ec, lw=lw, zorder=z)
    ax.add_patch(p)
    return p


def actor_box(ax, cx, y, label, w=200, h=52):
    rounded(ax, cx - w / 2, y, w, h, GREEN)
    ax.text(cx, y + h / 2, label, ha="center", va="center", fontsize=13,
            fontweight="bold", color="white", fontfamily=SANS)


def lifeline(ax, cx, y0, y1):
    ax.plot([cx, cx], [y0, y1], ls=(0, (2, 3)), lw=1.1, color="#c9c9c9", zorder=1)


def band(ax, x0, x1, y, label, h=34):
    rounded(ax, x0, y, x1 - x0, h, GREEN_SOFT, r=10, z=2)
    ax.text((x0 + x1) / 2, y + h / 2, label.upper(), ha="center", va="center",
            fontsize=11, fontweight="bold", color=GREEN_MID, fontfamily=SANS)
    for t in ax.texts[-1:]:
        t.set_fontsize(11)
    ax.texts[-1].set_text(" ".join(label.upper()) if False else label.upper())


def arrow(ax, x0, x1, y, label, dashed=False, fs=11.5, label_dy=-12):
    st = "Simple,tail_width=0.4,head_width=7,head_length=9"
    a = FancyArrowPatch((x0, y), (x1, y), arrowstyle=st, color=INK,
                        lw=0, zorder=3,
                        linestyle="dashed" if dashed else "solid")
    if dashed:
        # matplotlib fills Simple arrows; emulate dashes with a line + head
        a = FancyArrowPatch((x0, y), (x1, y), arrowstyle="-|>", mutation_scale=16,
                            color=INK, lw=1.4, zorder=3, linestyle=(0, (5, 4)))
    ax.add_patch(a)
    ax.text((x0 + x1) / 2, y + label_dy, label, ha="center", va="center",
            fontsize=fs, color=INK, fontfamily=SANS)


def self_loop(ax, x, y, label, fs=11.5, side="right"):
    # small self-referencing hook: out, down, back with an arrowhead
    w, h = 34, 18
    s = 1 if side == "right" else -1
    ax.plot([x, x + s * w, x + s * w], [y, y, y + h], lw=1.4, color=INK, zorder=3)
    a = FancyArrowPatch((x + s * w, y + h), (x, y + h), arrowstyle="-|>",
                        mutation_scale=14, color=INK, lw=1.4, zorder=3)
    ax.add_patch(a)
    if side == "right":
        ax.text(x + w + 12, y + h / 2, label, ha="left", va="center", fontsize=fs,
                color=INK, fontfamily=SANS)
    else:
        ax.text(x - w - 12, y + h / 2, label, ha="right", va="center", fontsize=fs,
                color=INK, fontfamily=SANS)


def entity_card(ax, x, y, w, title_text, rows, foot=None, hdr_h=36, row_h=25,
                pad_bottom=10):
    """rows: list of (left_mono_text, right_muted_note). Returns total height."""
    h = hdr_h + len(rows) * row_h + (22 if foot else 0) + pad_bottom
    rounded(ax, x, y, w, h, "white", ec=BORDER, lw=1.2, r=8, z=2)
    rounded(ax, x, y, w, hdr_h, GREEN, r=8, z=3)
    Rectangle
    ax.add_patch(Rectangle((x, y + hdr_h - 10), w, 10, fc=GREEN, ec="none", zorder=3))
    ax.text(x + w / 2, y + hdr_h / 2, title_text, ha="center", va="center",
            fontsize=12.5, fontweight="bold", color="white", fontfamily=MONO, zorder=4)
    yy = y + hdr_h + row_h / 2 + 2
    for left, right in rows:
        ax.text(x + 14, yy, left, ha="left", va="center", fontsize=10.5,
                color=INK, fontfamily=MONO, zorder=4)
        if right:
            ax.text(x + w - 14, yy, right, ha="right", va="center", fontsize=9,
                    color=MUT, fontfamily=SANS, zorder=4)
        yy += row_h
    if foot:
        ax.text(x + w / 2, y + h - pad_bottom - 8, foot, ha="center", va="center",
                fontsize=9, style="italic", color=MUT, fontfamily=SANS, zorder=4)
    return h


def node(ax, cx, cy, text, w=210, h=54, fc="white", ec=BORDER, tc=INK,
         bold=False, fs=11, r=10, sub=None):
    rounded(ax, cx - w / 2, cy - h / 2, w, h, fc, ec=ec, lw=1.3, r=r, z=3)
    if sub:
        ax.text(cx, cy - 8, text, ha="center", va="center", fontsize=fs, zorder=4,
                fontweight="bold" if bold else "normal", color=tc, fontfamily=SANS)
        ax.text(cx, cy + 12, sub, ha="center", va="center", fontsize=9, zorder=4,
                color=MUT if tc == INK else tc, fontfamily=SANS)
    else:
        ax.text(cx, cy, text, ha="center", va="center", fontsize=fs, zorder=4,
                fontweight="bold" if bold else "normal", color=tc, fontfamily=SANS,
                linespacing=1.35)


def edge(ax, p0, p1, label=None, dashed=False, curve=0.0, fs=9.5, lc=INK,
         label_off=(0, -10)):
    a = FancyArrowPatch(p0, p1, arrowstyle="-|>", mutation_scale=14, color=lc,
                        lw=1.4, zorder=2, connectionstyle=f"arc3,rad={curve}",
                        linestyle=(0, (5, 4)) if dashed else "solid",
                        shrinkA=6, shrinkB=6)
    ax.add_patch(a)
    if label:
        mx, my = (p0[0] + p1[0]) / 2 + label_off[0], (p0[1] + p1[1]) / 2 + label_off[1]
        ax.text(mx, my, label, ha="center", va="center", fontsize=fs, color=MUT,
                fontfamily=SANS, zorder=4,
                bbox=dict(fc="white", ec="none", pad=1.5))


def footnote(ax, w, y, text):
    ax.text(w / 2, y, text, ha="center", va="center", fontsize=10.5,
            style="italic", color=MUT, fontfamily=SANS)


def save(fig, path):
    fig.savefig(path, dpi=100, facecolor="white")
    plt.close(fig)
    print("wrote", path)
