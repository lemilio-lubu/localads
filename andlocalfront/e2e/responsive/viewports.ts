/* La matriz de la auditoría responsive. Los cinco primeros son teléfonos en
   vertical, «land» el mismo teléfono girado, «tab*» las dos tablets, y los
   dos últimos son escritorio: «desk» porque ahí viven los desbordamientos de
   las listas admin, «ref» como línea base que no debe cambiar. */
export type Viewport = {
  id: string;
  width: number;
  height: number;
  /* Táctil: activa las reglas que solo importan con el dedo (zoom de iOS al
     enfocar, áreas táctiles, tooltips que no se pueden ver). */
  touch: boolean;
};

export const viewports: Viewport[] = [
  { id: "xs", width: 320, height: 640, touch: true },
  { id: "s1", width: 360, height: 780, touch: true },
  { id: "s2", width: 375, height: 667, touch: true },
  { id: "m", width: 390, height: 844, touch: true },
  { id: "l", width: 430, height: 932, touch: true },
  { id: "land", width: 844, height: 390, touch: true },
  { id: "tab", width: 768, height: 1024, touch: true },
  { id: "tabL", width: 1024, height: 768, touch: true },
  { id: "desk", width: 1280, height: 800, touch: false },
  { id: "ref", width: 1440, height: 900, touch: false },
];

/* La línea base de escritorio: capturas que ninguna corrección responsive
   puede alterar. */
export const desktopBaseline = viewports.filter((viewport) => !viewport.touch);
