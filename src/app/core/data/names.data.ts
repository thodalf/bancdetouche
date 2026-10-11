/** Réservoirs de noms par nationalité, pour générer des joueurs fictifs. */
export interface NamePool {
  nationality: string;
  /** Poids de base (championnat français et joueurs libres). */
  weight: number;
  first: string[];
  last: string[];
}

export const NAME_POOLS: NamePool[] = [
  {
    nationality: 'FRA',
    weight: 55,
    first: ['Lucas', 'Hugo', 'Théo', 'Nathan', 'Mathis', 'Enzo', 'Louis', 'Jules', 'Maxime', 'Clément', 'Antoine', 'Baptiste', 'Romain', 'Adrien', 'Kylian', 'Yanis', 'Rayan', 'Sacha', 'Bastien', 'Quentin', 'Florian', 'Valentin', 'Corentin', 'Gaël', 'Mathéo', 'Noé', 'Malo', 'Aurélien', 'Damien', 'Loïc', 'Tanguy', 'Benjamin', 'Moussa', 'Ibrahim', 'Mehdi', 'Karim', 'Sofiane', 'Ousmane', 'Mamadou', 'Wesley', 'Alexis', 'Thomas', 'Paul', 'Arthur', 'Raphaël', 'Gabin', 'Évan', 'Timéo', 'Lenny', 'Nolan', 'Killian', 'Dylan', 'Jordan', 'Kévin', 'Jérémy', 'Anthony', 'Mathieu', 'Guillaume', 'Victor', 'Simon', 'Axel', 'Tom', 'Léo', 'Elias', 'Ilan', 'Bilal', 'Samir', 'Rémi', 'Pierre', 'Hippolyte', 'Désiré', 'Steve', 'Abdoulaye', 'Youssouf', 'Kenny', 'Warren', 'Brice', 'Cédric', 'Fabien', 'Joris'],
    last: ['Martin', 'Bernard', 'Dubois', 'Durand', 'Lefèvre', 'Moreau', 'Laurent', 'Garnier', 'Rousseau', 'Fontaine', 'Chevalier', 'Mercier', 'Blanchard', 'Perrin', 'Morel', 'Gauthier', 'Lemoine', 'Roussel', 'Fournier', 'Girard', 'Bonnet', 'Lambert', 'Faure', 'Vidal', 'Marchand', 'Le Gall', 'Kerjean', 'Tanguy', 'Pasquier', 'Barbier', 'Diallo', 'Traoré', 'Camara', 'Koné', 'Cissé', 'Benali', 'Haddad', 'Mendy', 'Sylla', 'Baldé', 'Petit', 'Robert', 'Richard', 'Simon', 'Michel', 'Leroy', 'Roux', 'David', 'Bertrand', 'Morin', 'Fournel', 'Guérin', 'Boyer', 'Clément', 'Masson', 'Henry', 'Nicolas', 'Lucas', 'Brun', 'Blanc', 'Muller', 'Lefort', 'Collin', 'Caron', 'Picard', 'Renaud', 'Aubert', 'Lacroix', 'Rolland', 'Le Bihan', 'Le Goff', 'Quéré', 'Pinel', 'Baudry', 'Hamon', 'Delmas', 'Carpentier', 'Weber', 'Doucouré', 'Coulibaly', 'Fofana', 'Bakary', 'Gomis', 'Mbaye', 'Ekotto', 'Lopes', 'Da Silva', 'Ferreira', 'Hernandez', 'Ruiz', 'Bouzid', 'Amara', 'Lemaire', 'Vasseur', 'Toussaint', 'Jacquet', 'Barret', 'Courtois', 'Maillard', 'Gilbert', 'Royer', 'Meunier', 'Chauvin', 'Colas', 'Leblanc', 'Prévost', 'Langlois', 'Hubert', 'Bouvier', 'Tessier', 'Bailly', 'Germain', 'Ollivier', 'Riviere', 'Marie', 'Poirier'],
  },
  {
    nationality: 'ENG',
    weight: 3,
    first: ['Harry', 'Jack', 'Oliver', 'George', 'Charlie', 'James', 'William', 'Thomas', 'Joshua', 'Daniel', 'Mason', 'Declan', 'Marcus', 'Jordan', 'Kyle', 'Reece', 'Aaron', 'Ben', 'Callum', 'Conor', 'Dominic', 'Ethan', 'Freddie', 'Harvey', 'Jamie', 'Kieran', 'Luke', 'Morgan', 'Nathaniel', 'Ollie', 'Ryan', 'Sam', 'Tyrone', 'Archie', 'Alfie', 'Lewis', 'Danny', 'Jesse', 'Ashley', 'Curtis', 'Levi', 'Jake'],
    last: ['Smith', 'Jones', 'Taylor', 'Brown', 'Williams', 'Wilson', 'Johnson', 'Davies', 'Robinson', 'Wright', 'Thompson', 'Evans', 'Walker', 'White', 'Roberts', 'Green', 'Hall', 'Wood', 'Jackson', 'Clarke', 'Hughes', 'Harrison', 'Mitchell', 'Shaw', 'Barker', 'Fletcher', 'Ward', 'Ashworth', 'Cooper', 'Turner', 'Parker', 'Collins', 'Bennett', 'Lloyd', 'Marshall', 'Chapman', 'Ellis', 'Hunt', 'Holmes', 'Mason', 'Palmer', 'Dixon', 'Knight', 'Webb', 'Spencer', 'Pearson', 'Hart', 'Lawson', 'Holloway', 'Pritchard', 'Whitfield', 'Cartwright', 'Thornton', 'Ramsden'],
  },
  {
    nationality: 'SCO',
    weight: 1,
    first: ['Andrew', 'Scott', 'Callum', 'Billy', 'Kenny', 'Ross', 'Craig', 'Euan', 'Fraser', 'Lyndon', 'Grant', 'Kieran'],
    last: ['MacLeod', 'Robertson', 'Campbell', 'Stewart', 'Paterson', 'Fraser', 'Henderson', 'Murray', 'Ross', 'Anderson', 'Kerr', 'Gillespie', 'Morrison', 'Duncan', 'Buchanan'],
  },
  {
    nationality: 'IRL',
    weight: 1,
    first: ['Seamus', 'Shane', 'Callum', 'Darragh', 'Evan', 'Cian', 'Finn', 'Josh', 'Liam', 'Niall'],
    last: ['O’Brien', 'Duffy', 'Doherty', 'Byrne', 'Murphy', 'Walsh', 'O’Shea', 'Kelly', 'Ryan', 'O’Connor', 'McCarthy', 'Gallagher', 'Brennan', 'Nolan', 'Dunne'],
  },
  {
    nationality: 'WAL',
    weight: 1,
    first: ['Gareth', 'Aaron', 'Daniel', 'Ethan', 'Harry', 'Joe', 'Kieffer', 'Rhys', 'Ben', 'Neco'],
    last: ['Jones', 'Williams', 'Davies', 'Evans', 'Thomas', 'Roberts', 'Lewis', 'Hughes', 'Morgan', 'Griffiths', 'Owen', 'Price', 'Powell', 'Rees', 'Pugh'],
  },
  {
    nationality: 'ESP',
    weight: 6,
    first: ['Pablo', 'Sergio', 'Álvaro', 'Iker', 'Javier', 'Raúl', 'Diego', 'Marcos', 'Pedro', 'Dani', 'Fernando', 'Carlos', 'Rodrigo', 'Mikel', 'Unai', 'Aitor', 'Íñigo', 'Jordi', 'Marc', 'Adrián', 'Hugo', 'Alejandro', 'Rubén', 'Óscar', 'Víctor', 'Jesús', 'Borja', 'Nacho', 'Ferran', 'Ander', 'Jon', 'Gorka', 'Martín', 'Nico', 'Fermín', 'Aleix', 'Álex', 'Samuel', 'Manuel', 'Andrés'],
    last: ['García', 'Romero', 'Navarro', 'Ortega', 'Castillo', 'Morales', 'Delgado', 'Vega', 'Fernández', 'González', 'Rodríguez', 'López', 'Martínez', 'Sánchez', 'Pérez', 'Gómez', 'Díaz', 'Moreno', 'Muñoz', 'Álvarez', 'Jiménez', 'Ruiz', 'Hernández', 'Iglesias', 'Torres', 'Ramos', 'Gil', 'Serrano', 'Blanco', 'Molina', 'Suárez', 'Ortiz', 'Rubio', 'Marín', 'Sanz', 'Núñez', 'Medina', 'Garrido', 'Cortés', 'Castro', 'Lozano', 'Guerrero', 'Prieto', 'Calvo', 'Cabrera', 'Aguirre', 'Etxeberria', 'Arrieta', 'Larrañaga', 'Ibarra'],
  },
  {
    nationality: 'POR',
    weight: 5,
    first: ['João', 'Tiago', 'Rúben', 'Gonçalo', 'Diogo', 'Rafael', 'Bernardo', 'Bruno', 'Nuno', 'Pedro', 'Vitinha', 'Francisco', 'André', 'Ricardo', 'Renato', 'Otávio', 'Luís', 'Miguel'],
    last: ['Silva', 'Costa', 'Ferreira', 'Pereira', 'Almeida', 'Carvalho', 'Fernandes', 'Mendes', 'Gomes', 'Martins', 'Rodrigues', 'Lopes', 'Marques', 'Ribeiro', 'Sousa', 'Pinto', 'Correia', 'Teixeira', 'Monteiro', 'Moreira', 'Cardoso', 'Vieira', 'Barros', 'Nogueira'],
  },
  {
    nationality: 'ITA',
    weight: 4,
    first: ['Marco', 'Lorenzo', 'Federico', 'Matteo', 'Andrea', 'Davide', 'Alessandro', 'Gianluca', 'Nicolò', 'Giacomo', 'Riccardo', 'Francesco', 'Simone', 'Stefano', 'Leonardo', 'Mattia', 'Giovanni', 'Daniele', 'Ciro', 'Sandro', 'Manuel', 'Pietro', 'Tommaso', 'Gianluigi', 'Domenico', 'Salvatore', 'Fabio', 'Raffaele', 'Antonio', 'Luca'],
    last: ['Rossi', 'Bianchi', 'Ferrari', 'Esposito', 'Ricci', 'Marino', 'Romano', 'Colombo', 'Bruno', 'Gallo', 'Conti', 'De Luca', 'Mancini', 'Costa', 'Giordano', 'Rizzo', 'Lombardi', 'Moretti', 'Barbieri', 'Fontana', 'Santoro', 'Mariani', 'Rinaldi', 'Caruso', 'Ferrara', 'Galli', 'Martini', 'Leone', 'Longo', 'Gentile', 'Martinelli', 'Vitale', 'Serra', 'Coppola', 'De Santis', 'D’Angelo', 'Marchetti', 'Parisi', 'Villa', 'Cattaneo', 'Fabbri', 'Bellini'],
  },
  {
    nationality: 'GER',
    weight: 3,
    first: ['Lukas', 'Leon', 'Jonas', 'Niklas', 'Felix', 'Julian', 'Kai', 'Florian', 'Jamal', 'Joshua', 'Leroy', 'Timo', 'Manuel', 'Marc-André', 'Thomas', 'Toni', 'Ilkay', 'Antonio', 'Robin', 'Nico', 'Maximilian', 'David', 'Benjamin', 'Tim', 'Jan', 'Moritz', 'Paul', 'Finn', 'Tobias', 'Dennis'],
    last: ['Müller', 'Schmidt', 'Schneider', 'Fischer', 'Weber', 'Meyer', 'Wagner', 'Becker', 'Schulz', 'Hoffmann', 'Koch', 'Richter', 'Klein', 'Wolf', 'Schröder', 'Neumann', 'Schwarz', 'Zimmermann', 'Braun', 'Krüger', 'Hofmann', 'Hartmann', 'Lange', 'Schmitt', 'Werner', 'Krause', 'Lehmann', 'Köhler', 'Maier', 'Huber', 'Kaiser', 'Fuchs', 'Peters', 'Lang', 'Scholz', 'Möller', 'Weiß', 'Jung', 'Hahn', 'Vogel', 'Friedrich', 'Keller'],
  },
  {
    nationality: 'AUT',
    weight: 1,
    first: ['David', 'Marcel', 'Lukas', 'Christoph', 'Florian', 'Stefan', 'Patrick', 'Philipp', 'Kevin', 'Michael', 'Daniel', 'Julian'],
    last: ['Gruber', 'Huber', 'Bauer', 'Wagner', 'Pichler', 'Steiner', 'Moser', 'Mayer', 'Hofer', 'Leitner', 'Berger', 'Fuchs', 'Eder', 'Fischer', 'Schmid'],
  },
  {
    nationality: 'SUI',
    weight: 1,
    first: ['Luca', 'Manuel', 'Fabian', 'Nico', 'Remo', 'Dan', 'Silvan', 'Cedric', 'Yannick', 'Noah', 'Jan', 'Simon'],
    last: ['Meier', 'Keller', 'Weber', 'Huber', 'Schneider', 'Steiner', 'Brunner', 'Baumann', 'Gerber', 'Frei', 'Moser', 'Zimmermann', 'Widmer', 'Wyss', 'Graf'],
  },
  {
    nationality: 'NED',
    weight: 2,
    first: ['Daan', 'Sem', 'Lars', 'Bram', 'Thijs', 'Ruben', 'Jesse', 'Stijn', 'Luuk', 'Milan', 'Tom', 'Jasper', 'Niels', 'Sven', 'Joost', 'Wouter'],
    last: ['de Jong', 'Jansen', 'de Vries', 'van den Berg', 'van Dijkstra', 'Bakker', 'Visser', 'Smit', 'Meijer', 'de Boer', 'Mulder', 'de Groot', 'Bos', 'Vos', 'Peters', 'Hendriks', 'van Leeuwen', 'Dekker', 'Brouwer', 'de Wit', 'Dijkman', 'Kok', 'Verhoeven', 'van der Linden'],
  },
  {
    nationality: 'BEL',
    weight: 5,
    first: ['Arthur', 'Thibaut', 'Wout', 'Jens', 'Dries', 'Maxim', 'Youri', 'Romelu', 'Leandro', 'Amadou', 'Jérémy', 'Loïs', 'Charles', 'Zeno', 'Hans', 'Aster', 'Orel', 'Koen', 'Timothy', 'Arne'],
    last: ['Peeters', 'Janssens', 'Maes', 'Claes', 'Wouters', 'Goossens', 'Jacobs', 'Mertens', 'Willems', 'Hermans', 'Lambrechts', 'De Smet', 'Dubois', 'Lemaire', 'Desmet', 'Michiels', 'Van Damme', 'Martens', 'Verbeke', 'Coppens', 'Declercq', 'Vandenberghe'],
  },
  {
    nationality: 'DEN',
    weight: 1,
    first: ['Christian', 'Mads', 'Kasper', 'Rasmus', 'Mikkel', 'Jonas', 'Andreas', 'Frederik', 'Morten', 'Victor', 'Lucas', 'Oliver'],
    last: ['Nielsen', 'Jensen', 'Hansen', 'Pedersen', 'Andersen', 'Christensen', 'Larsen', 'Sørensen', 'Rasmussen', 'Jørgensen', 'Petersen', 'Madsen', 'Kristensen', 'Olsen', 'Thomsen'],
  },
  {
    nationality: 'SWE',
    weight: 1,
    first: ['Alexander', 'Viktor', 'Emil', 'Oskar', 'Isak', 'Jesper', 'Gustaf', 'Hugo', 'Anton', 'Filip', 'Linus', 'Albin'],
    last: ['Andersson', 'Johansson', 'Karlsson', 'Nilsson', 'Eriksson', 'Larsson', 'Olsson', 'Persson', 'Svensson', 'Gustafsson', 'Pettersson', 'Jonsson', 'Jansson', 'Hansson', 'Bengtsson'],
  },
  {
    nationality: 'NOR',
    weight: 1,
    first: ['Erik', 'Martin', 'Alexander', 'Sander', 'Kristoffer', 'Leo', 'Oscar', 'Fredrik', 'Magnus', 'Jørgen', 'Henrik', 'Sindre'],
    last: ['Hansen', 'Johansen', 'Olsen', 'Larsen', 'Andersen', 'Pedersen', 'Nilsen', 'Kristiansen', 'Jensen', 'Karlsen', 'Johnsen', 'Pettersen', 'Eriksen', 'Berg', 'Haugen'],
  },
  {
    nationality: 'POL',
    weight: 1,
    first: ['Piotr', 'Wojciech', 'Jakub', 'Kamil', 'Michał', 'Sebastian', 'Mateusz', 'Krzysztof', 'Tomasz', 'Paweł', 'Łukasz', 'Bartosz'],
    last: ['Nowak', 'Kowalski', 'Wiśniewski', 'Wójcik', 'Kowalczyk', 'Kamiński', 'Lewandowicz', 'Zieliński', 'Szymański', 'Woźniak', 'Dąbrowski', 'Kozłowski', 'Jankowski', 'Mazur', 'Krawczyk'],
  },
  {
    nationality: 'CRO',
    weight: 1,
    first: ['Luka', 'Mateo', 'Ivan', 'Josip', 'Andrej', 'Marko', 'Lovro', 'Martin', 'Ante', 'Dominik', 'Filip', 'Nikola'],
    last: ['Horvat', 'Kovačević', 'Babić', 'Marić', 'Jurić', 'Novak', 'Kovačić', 'Knežević', 'Vuković', 'Marković', 'Petrović', 'Matić', 'Tomić', 'Pavlović', 'Božić'],
  },
  {
    nationality: 'SRB',
    weight: 1,
    first: ['Dušan', 'Aleksandar', 'Stefan', 'Nemanja', 'Filip', 'Strahinja', 'Lazar', 'Uroš', 'Marko', 'Veljko', 'Miloš', 'Luka'],
    last: ['Jovanović', 'Petrović', 'Nikolić', 'Marković', 'Đorđević', 'Stojanović', 'Ilić', 'Stanković', 'Pavlović', 'Milošević', 'Popović', 'Todorović', 'Ristić', 'Kostić', 'Lazić'],
  },
  {
    nationality: 'TUR',
    weight: 1,
    first: ['Hakan', 'Arda', 'Kenan', 'Emre', 'Mert', 'Burak', 'Orkun', 'Kerem', 'Barış', 'Semih', 'Yusuf', 'Can'],
    last: ['Yılmaz', 'Kaya', 'Demir', 'Şahin', 'Çelik', 'Yıldız', 'Yıldırım', 'Öztürk', 'Aydın', 'Özdemir', 'Arslan', 'Doğan', 'Kılıç', 'Aslan', 'Çetin'],
  },
  {
    nationality: 'BRA',
    weight: 5,
    first: ['Gabriel', 'Matheus', 'Vinícius', 'Thiago', 'Caio', 'Felipe', 'Lucas', 'Bruno', 'Rafael', 'Gustavo', 'Leonardo', 'Pedro', 'Danilo', 'Douglas', 'Igor', 'João Pedro', 'Wesley', 'Gerson', 'André', 'Murilo', 'Rodrigo', 'Eduardo', 'Henrique', 'Diego'],
    last: ['Santos', 'Oliveira', 'Souza', 'Rodrigues', 'Lima', 'Barbosa', 'Ferreira', 'Alves', 'Pereira', 'Gomes', 'Ribeiro', 'Carvalho', 'Almeida', 'Araújo', 'Nascimento', 'Moraes', 'Teixeira', 'Fonseca', 'Cardoso', 'Rocha', 'Dias', 'Mendes', 'Freitas', 'Cavalcanti'],
  },
  {
    nationality: 'ARG',
    weight: 3,
    first: ['Lionel', 'Julián', 'Lautaro', 'Enzo', 'Alexis', 'Rodrigo', 'Nicolás', 'Cristian', 'Emiliano', 'Ángel', 'Paulo', 'Leandro', 'Alejandro', 'Giuliano', 'Exequiel', 'Thiago', 'Valentín', 'Facundo'],
    last: ['González', 'Rodríguez', 'Gómez', 'Fernández', 'López', 'Díaz', 'Martínez', 'Pérez', 'Romero', 'Sosa', 'Álvarez', 'Torres', 'Ruiz', 'Ramírez', 'Flores', 'Acosta', 'Benítez', 'Medina', 'Herrera', 'Aguirre', 'Gutiérrez', 'Pereyra'],
  },
  {
    nationality: 'URU',
    weight: 1,
    first: ['Federico', 'Matías', 'Rodrigo', 'Facundo', 'Maximiliano', 'Nicolás', 'Agustín', 'Santiago', 'Joaquín', 'Bruno'],
    last: ['Rodríguez', 'González', 'Fernández', 'Pereira', 'Silva', 'Sosa', 'Suárez', 'Cabrera', 'Méndez', 'Núñez', 'Olivera', 'Acosta', 'Castro', 'Vázquez', 'Techera'],
  },
  {
    nationality: 'COL',
    weight: 1,
    first: ['Luis', 'James', 'Jhon', 'Davinson', 'Daniel', 'Richard', 'Yerry', 'Jefferson', 'Kevin', 'Juan'],
    last: ['Rodríguez', 'Gómez', 'González', 'Martínez', 'García', 'López', 'Hernández', 'Sánchez', 'Ramírez', 'Torres', 'Rojas', 'Moreno', 'Castro', 'Ospina', 'Valencia'],
  },
  {
    nationality: 'MEX',
    weight: 1,
    first: ['Hirving', 'Edson', 'Santiago', 'Raúl', 'Guillermo', 'César', 'Johan', 'Orbelín', 'Luis', 'Julián'],
    last: ['Hernández', 'García', 'Martínez', 'López', 'González', 'Rodríguez', 'Pérez', 'Sánchez', 'Ramírez', 'Cruz', 'Flores', 'Gómez', 'Morales', 'Reyes', 'Jiménez'],
  },
  {
    nationality: 'USA',
    weight: 1,
    first: ['Christian', 'Tyler', 'Brandon', 'Josh', 'Matt', 'Chris', 'Ryan', 'Kyle', 'Jordan', 'Cameron', 'Logan', 'Austin'],
    last: ['Smith', 'Johnson', 'Miller', 'Davis', 'Anderson', 'Moore', 'Martin', 'Thompson', 'Clark', 'Lewis', 'Walker', 'Young', 'Allen', 'King', 'Scott'],
  },
  {
    nationality: 'SEN',
    weight: 6,
    first: ['Cheikh', 'Pape', 'Ismaïla', 'Abdou', 'Lamine', 'Babacar', 'Sadio', 'Kalidou', 'Édouard', 'Idrissa', 'Nicolas', 'Iliman', 'Habib', 'Krépin', 'Nampalys', 'Boulaye'],
    last: ['Ndiaye', 'Diop', 'Sarr', 'Faye', 'Gueye', 'Seck', 'Diatta', 'Dieng', 'Ciss', 'Camara', 'Sow', 'Badji', 'Niang', 'Fall', 'Mbengue', 'Thiam', 'Kane', 'Diouf'],
  },
  {
    nationality: 'CIV',
    weight: 5,
    first: ['Serge', 'Wilfried', 'Yannick', 'Didier', 'Seko', 'Franck', 'Sébastien', 'Simon', 'Evan', 'Odilon', 'Jean-Philippe', 'Ibrahim', 'Christian', 'Oumar'],
    last: ['Kouassi', 'Bamba', 'Yao', 'Koffi', 'Touré', 'Kouamé', 'Konan', 'N’Guessan', 'Ouattara', 'Sangaré', 'Fofana', 'Diomandé', 'Kouakou', 'Aka', 'Tano'],
  },
  {
    nationality: 'MLI',
    weight: 2,
    first: ['Yves', 'Amadou', 'Moussa', 'Hamari', 'Kamory', 'Lassana', 'Mohamed', 'Boubacar', 'Sékou', 'Nene'],
    last: ['Traoré', 'Diarra', 'Keïta', 'Coulibaly', 'Konaté', 'Sissoko', 'Dembélé', 'Doumbia', 'Sidibé', 'Kanouté', 'Maïga', 'Sangaré', 'Touré', 'Cissé', 'Diallo'],
  },
  {
    nationality: 'CMR',
    weight: 2,
    first: ['Jean', 'Patrick', 'Christian', 'Olivier', 'Franck', 'Serge', 'Paul', 'Joseph', 'Arnaud', 'Stéphane'],
    last: ['Mbarga', 'Nkoulou', 'Eto', 'Ngono', 'Abena', 'Essomba', 'Fouda', 'Atangana', 'Mballa', 'Tchoumi', 'Ndongo', 'Owona', 'Nguema', 'Biya', 'Eyenga'],
  },
  {
    nationality: 'NGA',
    weight: 2,
    first: ['Chidi', 'Emeka', 'Tunde', 'Samuel', 'Ikenna', 'Femi', 'Kelechi', 'Chinedu', 'Segun', 'Uche', 'Tobi', 'Musa'],
    last: ['Okafor', 'Okonkwo', 'Adeyemi', 'Eze', 'Nwosu', 'Balogun', 'Adebayo', 'Okoro', 'Obi', 'Chukwu', 'Ogunleye', 'Ibe', 'Uche', 'Nnamdi', 'Afolabi'],
  },
  {
    nationality: 'GHA',
    weight: 1,
    first: ['Kwame', 'Kofi', 'Kwabena', 'Yaw', 'Emmanuel', 'Daniel', 'Joseph', 'Isaac', 'Samuel', 'Ebenezer'],
    last: ['Mensah', 'Owusu', 'Boateng', 'Asante', 'Osei', 'Agyemang', 'Appiah', 'Addo', 'Amoah', 'Darko', 'Frimpong', 'Opoku', 'Badu', 'Quaye', 'Acheampong'],
  },
  {
    nationality: 'MAR',
    weight: 5,
    first: ['Achraf', 'Youssef', 'Hakim', 'Amine', 'Ilias', 'Nayef', 'Sofyan', 'Azzedine', 'Brahim', 'Bilal', 'Ismael', 'Noussair', 'Yassine', 'Anas', 'Mehdi'],
    last: ['El Idrissi', 'Bennani', 'Alaoui', 'Tazi', 'Amrani', 'Chraibi', 'Berrada', 'El Amrani', 'Benjelloun', 'Lahlou', 'Saidi', 'Ouazzani', 'El Fassi', 'Belhaj', 'Naciri', 'Rahmouni', 'Kettani'],
  },
  {
    nationality: 'ALG',
    weight: 4,
    first: ['Riyad', 'Ismaël', 'Rachid', 'Farès', 'Yacine', 'Amir', 'Saïd', 'Houssem', 'Ramiz', 'Aïssa', 'Nabil', 'Mohamed-Amine'],
    last: ['Bensaïd', 'Belkacem', 'Khelifi', 'Saïdi', 'Boudjema', 'Benali', 'Mansouri', 'Hamidi', 'Cherif', 'Bouzidi', 'Brahimi', 'Meziane', 'Haddadi', 'Larbi', 'Ait Ali'],
  },
  {
    nationality: 'TUN',
    weight: 1,
    first: ['Wahbi', 'Ellyes', 'Montassar', 'Aïssa', 'Hannibal', 'Youssef', 'Anis', 'Naïm', 'Elias', 'Seifeddine'],
    last: ['Ben Ali', 'Trabelsi', 'Jebali', 'Gharbi', 'Hammami', 'Ben Salah', 'Mejri', 'Ayari', 'Chaabane', 'Jaziri', 'Dridi', 'Ben Amor', 'Mabrouk', 'Sassi', 'Zouari'],
  },
  {
    nationality: 'JPN',
    weight: 1,
    first: ['Takumi', 'Kaoru', 'Takehiro', 'Wataru', 'Daichi', 'Ritsu', 'Junya', 'Ayase', 'Hiroki', 'Kenta', 'Yuto', 'Sota'],
    last: ['Sato', 'Suzuki', 'Takahashi', 'Tanaka', 'Watanabe', 'Ito', 'Yamamoto', 'Nakamura', 'Kobayashi', 'Kato', 'Yoshida', 'Yamada', 'Sasaki', 'Matsumoto', 'Inoue'],
  },
  {
    nationality: 'KOR',
    weight: 1,
    first: ['Min-jun', 'Seo-jun', 'Ji-ho', 'Jun-seo', 'Hyun-woo', 'Do-yun', 'Ji-hoon', 'Sung-min', 'Tae-yang', 'Woo-jin'],
    last: ['Kim', 'Lee', 'Park', 'Choi', 'Jung', 'Kang', 'Cho', 'Yoon', 'Jang', 'Lim', 'Han', 'Shin', 'Seo', 'Kwon', 'Hwang'],
  },
];

export const NATIONALITY_FLAGS: Record<string, string> = {
  FRA: '🇫🇷', ENG: '🏴󠁧󠁢󠁥󠁮󠁧󠁿', SCO: '🏴󠁧󠁢󠁳󠁣󠁴󠁿', WAL: '🏴󠁧󠁢󠁷󠁬󠁳󠁿', IRL: '🇮🇪', ESP: '🇪🇸', POR: '🇵🇹', ITA: '🇮🇹', GER: '🇩🇪', AUT: '🇦🇹', SUI: '🇨🇭',
  NED: '🇳🇱', BEL: '🇧🇪', DEN: '🇩🇰', SWE: '🇸🇪', NOR: '🇳🇴', POL: '🇵🇱', CRO: '🇭🇷', SRB: '🇷🇸', TUR: '🇹🇷', BRA: '🇧🇷', ARG: '🇦🇷',
  URU: '🇺🇾', COL: '🇨🇴', MEX: '🇲🇽', USA: '🇺🇸', SEN: '🇸🇳', CIV: '🇨🇮', MLI: '🇲🇱', CMR: '🇨🇲', NGA: '🇳🇬', GHA: '🇬🇭', MAR: '🇲🇦',
  ALG: '🇩🇿', TUN: '🇹🇳', JPN: '🇯🇵', KOR: '🇰🇷',
};

/** Préférences de recrutement par pays de championnat (multiplicateur du poids de base). */
export const LEAGUE_NATIONALITY_BIAS: Record<string, Record<string, number>> = {
  FRA: {},
  ENG: { ENG: 26, SCO: 6, IRL: 5, WAL: 5, FRA: 0.12, NGA: 2, GHA: 3, NED: 2, DEN: 3, NOR: 3, BRA: 1.2, ARG: 1.3, USA: 2, JPN: 2 },
  ESP: { ESP: 9, ARG: 3, URU: 4, COL: 4, MEX: 3, POR: 1.5, FRA: 0.12, BRA: 1.4, MAR: 1.2 },
  ITA: { ITA: 13, ARG: 3, URU: 3, SRB: 4, CRO: 4, FRA: 0.12, BRA: 1.4, NED: 2, POL: 3, NGA: 2, SUI: 2 },
  GER: { GER: 18, AUT: 8, SUI: 6, POL: 4, TUR: 6, DEN: 3, NED: 2, FRA: 0.12, CRO: 2, JPN: 3, KOR: 3, SWE: 2, NOR: 2 },
};
