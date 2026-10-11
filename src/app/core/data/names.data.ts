/** Réservoirs de noms par nationalité, pour générer des joueurs fictifs. */
export interface NamePool {
  nationality: string;
  weight: number;
  first: string[];
  last: string[];
}

export const NAME_POOLS: NamePool[] = [
  {
    nationality: 'FRA',
    weight: 55,
    first: ['Lucas', 'Hugo', 'Théo', 'Nathan', 'Mathis', 'Enzo', 'Louis', 'Jules', 'Maxime', 'Clément', 'Antoine', 'Baptiste', 'Romain', 'Adrien', 'Kylian', 'Yanis', 'Rayan', 'Sacha', 'Bastien', 'Quentin', 'Florian', 'Valentin', 'Corentin', 'Gaël', 'Mathéo', 'Noé', 'Malo', 'Aurélien', 'Damien', 'Loïc', 'Tanguy', 'Benjamin', 'Moussa', 'Ibrahim', 'Mehdi', 'Karim', 'Sofiane', 'Ousmane', 'Mamadou', 'Wesley'],
    last: ['Martin', 'Bernard', 'Dubois', 'Durand', 'Lefèvre', 'Moreau', 'Laurent', 'Garnier', 'Rousseau', 'Fontaine', 'Chevalier', 'Mercier', 'Blanchard', 'Perrin', 'Morel', 'Gauthier', 'Lemoine', 'Roussel', 'Fournier', 'Girard', 'Bonnet', 'Lambert', 'Faure', 'Vidal', 'Marchand', 'Le Gall', 'Kerjean', 'Tanguy', 'Pasquier', 'Barbier', 'Diallo', 'Traoré', 'Camara', 'Koné', 'Cissé', 'Benali', 'Haddad', 'Mendy', 'Sylla', 'Baldé'],
  },
  {
    nationality: 'ESP',
    weight: 6,
    first: ['Pablo', 'Sergio', 'Álvaro', 'Iker', 'Javier', 'Raúl', 'Diego', 'Marcos'],
    last: ['García', 'Romero', 'Navarro', 'Ortega', 'Castillo', 'Morales', 'Delgado', 'Vega'],
  },
  {
    nationality: 'POR',
    weight: 5,
    first: ['João', 'Tiago', 'Rúben', 'Gonçalo', 'Diogo', 'Rafael'],
    last: ['Silva', 'Costa', 'Ferreira', 'Pereira', 'Almeida', 'Carvalho'],
  },
  {
    nationality: 'BRA',
    weight: 5,
    first: ['Gabriel', 'Matheus', 'Vinícius', 'Thiago', 'Caio', 'Felipe'],
    last: ['Santos', 'Oliveira', 'Souza', 'Rodrigues', 'Lima', 'Barbosa'],
  },
  {
    nationality: 'SEN',
    weight: 6,
    first: ['Cheikh', 'Pape', 'Ismaïla', 'Abdou', 'Lamine', 'Babacar'],
    last: ['Ndiaye', 'Diop', 'Sarr', 'Faye', 'Gueye', 'Seck'],
  },
  {
    nationality: 'CIV',
    weight: 5,
    first: ['Serge', 'Wilfried', 'Yannick', 'Didier', 'Seko', 'Franck'],
    last: ['Kouassi', 'Bamba', 'Yao', 'Koffi', 'Touré', 'Gbamin'],
  },
  {
    nationality: 'BEL',
    weight: 5,
    first: ['Arthur', 'Thibaut', 'Wout', 'Jens', 'Dries', 'Maxim'],
    last: ['Peeters', 'Janssens', 'Maes', 'Claes', 'Wouters', 'Goossens'],
  },
  {
    nationality: 'MAR',
    weight: 5,
    first: ['Achraf', 'Youssef', 'Hakim', 'Amine', 'Ilias', 'Nayef'],
    last: ['El Idrissi', 'Bennani', 'Alaoui', 'Tazi', 'Amrani', 'Chraibi'],
  },
  {
    nationality: 'ALG',
    weight: 4,
    first: ['Riyad', 'Ismaël', 'Rachid', 'Farès', 'Yacine', 'Amir'],
    last: ['Mahrez', 'Bensaïd', 'Belkacem', 'Khelifi', 'Saïdi', 'Boudjema'],
  },
  {
    nationality: 'ITA',
    weight: 4,
    first: ['Marco', 'Lorenzo', 'Federico', 'Matteo', 'Andrea', 'Davide'],
    last: ['Rossi', 'Bianchi', 'Ferrari', 'Esposito', 'Ricci', 'Marino'],
  },
];

export const NATIONALITY_FLAGS: Record<string, string> = {
  FRA: '🇫🇷',
  ESP: '🇪🇸',
  POR: '🇵🇹',
  BRA: '🇧🇷',
  SEN: '🇸🇳',
  CIV: '🇨🇮',
  BEL: '🇧🇪',
  MAR: '🇲🇦',
  ALG: '🇩🇿',
  ITA: '🇮🇹',
};
